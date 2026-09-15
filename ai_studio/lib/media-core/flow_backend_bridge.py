import asyncio
import base64
import importlib.util
import json
import sys
import types
import urllib.request
from pathlib import Path


FLOW_ENGINE_DIR = Path(__file__).resolve().parent / "flow_engine"


def first_text(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def trace(message, **detail):
    if detail:
        safe = {key: value for key, value in detail.items() if value not in (None, "")}
        print(f"{message} {json.dumps(safe, ensure_ascii=False)}", file=sys.stderr, flush=True)
    else:
        print(message, file=sys.stderr, flush=True)


async def with_timeout(label, coro, seconds=60):
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except asyncio.TimeoutError as exc:
        raise RuntimeError(f"{label} timed out after {seconds}s.") from exc


async def get_labs_access_token(client, *, cookie_inject, labs_cookie):
    attempts = [
        ("labs+google-sso", cookie_inject),
        ("labs-only", labs_cookie),
    ]
    last_error = None
    for mode, cookie_value in attempts:
        if not first_text(cookie_value):
            continue
        try:
            trace("Flow bridge: requesting Google Labs access token", cookieMode=mode)
            access_token, cookie_header = await with_timeout(
                f"Google Labs access token ({mode})",
                client.get_access_token(cookie_value),
                seconds=45,
            )
            if access_token and cookie_header:
                trace("Flow bridge: access token ready", cookieMode=mode, hasAccessToken=True, cookieHeaderLength=len(cookie_header or ""))
                return access_token, cookie_header, mode
            last_error = RuntimeError(f"Google Labs did not return an access token with {mode} cookies.")
            trace("Flow bridge: access token missing", cookieMode=mode)
        except Exception as exc:
            last_error = exc
            trace("Flow bridge: access token failed", cookieMode=mode, error=str(exc))
    if last_error:
        raise RuntimeError(f"Cannot get Google Labs access token from current cookies: {last_error}") from last_error
    raise RuntimeError("Missing Google Labs cookies from extension.")


def aspect_value(value):
    text = first_text(value, "portrait")
    return {
        "9:16": "portrait",
        "portrait": "portrait",
        "vertical": "portrait",
        "16:9": "landscape",
        "landscape": "landscape",
        "1:1": "square",
        "square": "square",
        "4:5": "portrait",
    }.get(text.lower(), text)


def image_model_value(value, labs_generate):
    text = first_text(value, getattr(labs_generate, "DEFAULT_IMAGE_MODEL", "NARWHAL"))
    lower = text.lower()
    if "nano" in lower or "banana" in lower:
        return "NARWHAL"
    if "gem" in lower or "pix" in lower:
        return "GEM_PIX_2"
    return text


def load_image_bytes(value):
    text = first_text(value)
    if not text:
        return None
    if text.startswith("data:image/"):
        _, encoded = text.split(",", 1)
        return base64.b64decode(encoded)
    if text.startswith("http://") or text.startswith("https://"):
        req = urllib.request.Request(text, headers={"User-Agent": "AutoGT Pro/1.0"})
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read()
    root = Path(__file__).resolve().parents[2]
    if text.startswith("/"):
        file_path = root / text.lstrip("/")
    else:
        file_path = Path(text)
        if not file_path.is_absolute():
            file_path = root / text
    if file_path.is_file():
        return file_path.read_bytes()
    raise RuntimeError(f"Product image not found: {text}")


async def upload_reference_image(client, *, access_token, project_id, image_source):
    image_bytes = load_image_bytes(image_source)
    if not image_bytes:
        return None
    trace("Flow bridge: uploading product reference image", bytes=len(image_bytes), projectId=project_id)
    media_name = await client.upload_image(
        access_token=access_token,
        project_id=project_id,
        image_bytes=image_bytes,
        proxy=None,
    )
    return media_name


# Real model ids the picker sends (kept in sync with
# lib/flow-suite/shared/catalog.mjs FLOW_VIDEO_MODELS).
FLOW_VIDEO_MODEL_IDS = {
    "abra_r2v_4s",
    "abra_r2v_6s",
    "abra_r2v_8s",
    "abra_r2v_10s",
    "veo_3_1_r2v_lite_low_priority",
    "veo_3_1_r2v_lite",
    "veo_3_1_i2v_lite_low_priority",
    "veo_3_1_i2v_lite",
    "veo_3_1_i2v_s_fast_portrait_ultra",
}


def video_model_value(value):
    """Normalize the picked video model.

    A real model id is passed straight through. The substring matching below is
    only for the legacy friendly labels the old picker sent ("Lite", "Quality
    x20", ...): applied to today's ids it silently rewrote the model, e.g. the
    free "veo_3_1_r2v_lite_low_priority" matched "lite" and became the paid
    i2v "veo_3_1_i2v_lite", and "abra_r2v_10s" matched "10" and became
    "veo_3_1_i2v".
    """
    text = first_text(value, "veo_3_1_i2v_lite")
    if text in FLOW_VIDEO_MODEL_IDS:
        return text
    lower = text.lower()
    if "quality" in lower or "standard" in lower:
        return "veo_3_1_i2v"
    if "lite" in lower:
        return "veo_3_1_i2v_lite"
    return text


def load_labs_engine():
    if sys.version_info[:2] != (3, 11):
        raise RuntimeError("Flow API engine requires Python 3.11. Start server with py -3.11 available.")
    if not (FLOW_ENGINE_DIR / "labs_generate.pyc").is_file():
        raise RuntimeError("AutoTik Flow engine is missing.")
    package_name = "autotik_flow_engine"
    pkg = sys.modules.get(package_name)
    if pkg is None or not hasattr(pkg, "__path__"):
        pkg = types.ModuleType(package_name)
        pkg.__path__ = [str(FLOW_ENGINE_DIR)]
        pkg.__package__ = package_name
        sys.modules[package_name] = pkg

    def load_mod(short_name):
        full_name = f"{package_name}.{short_name}"
        if full_name in sys.modules:
            return sys.modules[full_name]
        spec = importlib.util.spec_from_file_location(full_name, FLOW_ENGINE_DIR / f"{short_name}.pyc")
        if not spec or not spec.loader:
            raise RuntimeError(f"Cannot load {full_name}")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[full_name] = mod
        spec.loader.exec_module(mod)
        return mod

    load_mod("labs")
    return load_mod("labs_generate"), str(FLOW_ENGINE_DIR)


def media_to_result(media, fallback_type, project_id):
    return {
        "ok": True,
        "mediaUrl": getattr(media, "url", "") or "",
        "mediaType": getattr(media, "media_type", "") or fallback_type,
        "mediaId": getattr(media, "media_id", "") or getattr(media, "id", "") or "",
        "workflowId": getattr(media, "workflow_id", "") or "",
        "sceneId": getattr(media, "scene_id", "") or "",
        "width": getattr(media, "width", None),
        "height": getattr(media, "height", None),
        "projectId": project_id,
    }


async def run(payload):
    labs_generate, ref_root = load_labs_engine()
    client = labs_generate.LabsGenerateClient(timeout=180.0)
    cookie_inject = first_text(payload.get("cookieInject"))
    labs_cookie = first_text(payload.get("cookie"))
    if not cookie_inject and not labs_cookie:
        raise RuntimeError("Missing Google Labs cookie from extension.")

    media_type = first_text(payload.get("mediaType"), "video").lower()
    options = payload.get("options") or {}
    prompt = first_text(payload.get("prompt"), options.get("prompt"))
    prompt_video = first_text(options.get("promptVideo"), payload.get("promptVideo"), prompt)
    if not prompt:
        raise RuntimeError("Flow prompt is empty.")

    access_token, cookie_header, cookie_mode = await get_labs_access_token(
        client,
        cookie_inject=cookie_inject,
        labs_cookie=labs_cookie,
    )

    project_id = first_text(options.get("projectId"), payload.get("projectId"))
    if not project_id:
        try:
            trace("Flow bridge: creating Google Flow project")
            project_id = await with_timeout(
                "Google Flow create project",
                client.create_project(cookie_header=cookie_header, title="AutoGT Pro"),
                seconds=60,
            )
        except Exception as exc:
            text = str(exc)
            if "401" in text or "Unauthorized" in text or "UNAUTHORIZED" in text:
                raise RuntimeError(
                    "Google Flow session is unauthorized while creating a project. "
                    "Open labs.google in this Chrome profile, confirm you are signed in and can open Flow, "
                    "then click Re-connect in AutoGT Pro Extension and retry."
                ) from exc
            raise
    if not project_id:
        raise RuntimeError("Google Flow project was not created.")
    trace("Flow bridge: project ready", projectId=project_id)

    aspect = aspect_value(options.get("aspect"))
    image_model = image_model_value(options.get("imageModel"), labs_generate)
    video_model = video_model_value(options.get("videoModel"))
    reference_image_ids = []
    product_image = first_text(options.get("productImage"), payload.get("productImage"))
    if product_image:
        uploaded_ref = await upload_reference_image(
            client,
            access_token=access_token,
            project_id=project_id,
            image_source=product_image,
        )
        if uploaded_ref:
            reference_image_ids.append(uploaded_ref)

    if media_type == "concat":
        video_media_ids = options.get("videoMediaIds") or payload.get("videoMediaIds") or []
        video_media_ids = [first_text(v) for v in video_media_ids if first_text(v)]
        if len(video_media_ids) < 2:
            raise RuntimeError("Flow concat needs at least 2 scene video mediaIds.")
        clip_seconds_text = first_text(options.get("clipSeconds"), payload.get("clipSeconds"), "8")
        try:
            clip_seconds = max(1, int(clip_seconds_text))
        except Exception:
            clip_seconds = 8
        trace("Flow bridge: concatenating scene videos", projectId=project_id, clips=len(video_media_ids), clipSeconds=clip_seconds)
        concat_media = await with_timeout(
            "Google Flow video concatenation",
            client.concatenate_videos(
                access_token=access_token,
                video_media_ids=video_media_ids,
                clip_seconds=clip_seconds,
                cookie_header=cookie_header,
                proxy=None,
            ),
            seconds=600,
        )
        result = media_to_result(concat_media, "video", project_id)
        result["sourceMediaIds"] = video_media_ids
        result["refRoot"] = ref_root
        trace("Flow bridge: video concatenation complete", mediaId=result.get("mediaId"), projectId=project_id)
        return result

    if media_type == "image":
        image_captcha = first_text(payload.get("imageCaptcha"))
        if not image_captcha:
            raise RuntimeError("Missing image reCAPTCHA token.")
        trace("Flow bridge: generating start image", projectId=project_id, model=image_model, aspect=aspect, hasReference=bool(reference_image_ids))
        image_media = await with_timeout(
            "Google Flow image generation",
            client.generate_image(
                access_token=access_token,
                recaptcha_token=image_captcha,
                project_id=project_id,
                prompt=prompt,
                aspect=aspect,
                model=image_model,
                seed=None,
                reference_image_ids=reference_image_ids or None,
                proxy=None,
            ),
            seconds=180,
        )
        result = media_to_result(image_media, "image", project_id)
        result["referenceImageIds"] = reference_image_ids
        result["refRoot"] = ref_root
        trace("Flow bridge: image generation complete", mediaId=result.get("mediaId"), projectId=project_id)
        return result

    video_captcha = first_text(payload.get("videoCaptcha"))
    if not video_captcha:
        raise RuntimeError("Missing video reCAPTCHA token.")

    if media_type == "extend":
        source_media_id = first_text(options.get("sourceMediaId"), options.get("source_media_id"), payload.get("sourceMediaId"))
        scene_id = first_text(options.get("sceneId"), options.get("scene_id"), payload.get("sceneId"))
        position_text = first_text(options.get("extendPosition"), options.get("position"), payload.get("extendPosition"), "1")
        try:
            position = max(1, int(position_text))
        except Exception:
            position = 1
        if not source_media_id:
            raise RuntimeError("Flow extend needs the previous clip mediaId.")
        if not scene_id:
            raise RuntimeError("Flow extend needs the previous clip sceneId.")
        extend_model = getattr(labs_generate, "VIDEO_EXTEND_MODEL", "veo_3_1_extension_lite")
        trace(
            "Flow bridge: extending video",
            projectId=project_id,
            sourceMediaId=source_media_id,
            sceneId=scene_id,
            position=position,
            model=extend_model,
        )
        video_media = await with_timeout(
            "Google Flow video extension",
            client.extend_video(
                access_token=access_token,
                recaptcha_token=video_captcha,
                project_id=project_id,
                scene_id=scene_id,
                source_media_id=source_media_id,
                prompt=prompt_video,
                position=position,
                aspect=aspect,
                model=extend_model,
                tier=None,
                seed=None,
                start_frame_index=None,
                end_frame_index=None,
                cookie_header=cookie_header,
                proxy=None,
            ),
            seconds=300,
        )
        result = media_to_result(video_media, "video", project_id)
        if not result.get("sceneId"):
            result["sceneId"] = scene_id
        result["sourceMediaId"] = source_media_id
        result["sourceSceneId"] = scene_id
        result["extendPosition"] = position
        result["referenceImageIds"] = reference_image_ids
        result["canExtend"] = bool(result.get("mediaId") and result.get("sceneId"))
        result["refRoot"] = ref_root
        trace("Flow bridge: video extension complete", mediaId=result.get("mediaId"), projectId=project_id, sceneId=result.get("sceneId"))
        return result

    start_media_id = first_text(options.get("startImageMediaId"), payload.get("startImageMediaId"))
    start_image_result = None
    if not start_media_id:
        image_captcha = first_text(payload.get("imageCaptcha"))
        if not image_captcha:
            raise RuntimeError("Missing image reCAPTCHA token for video start image.")
        trace("Flow bridge: generating start image for video", projectId=project_id, model=image_model, aspect=aspect, hasReference=bool(reference_image_ids))
        image_media = await with_timeout(
            "Google Flow start image generation",
            client.generate_image(
                access_token=access_token,
                recaptcha_token=image_captcha,
                project_id=project_id,
                prompt=prompt,
                aspect=aspect,
                model=image_model,
                seed=None,
                reference_image_ids=reference_image_ids or None,
                proxy=None,
            ),
            seconds=180,
        )
        start_image_result = media_to_result(image_media, "image", project_id)
        start_media_id = getattr(image_media, "media_id", "") or getattr(image_media, "id", "")
        if not start_media_id:
            raise RuntimeError("Google Flow returned an image without media id, so video cannot start.")
        trace("Flow bridge: start image ready for video", startImageMediaId=start_media_id)

    trace("Flow bridge: generating video", projectId=project_id, model=video_model, aspect=aspect, startImageMediaId=start_media_id)
    video_media = await with_timeout(
        "Google Flow video generation",
        client.generate_video(
            access_token=access_token,
            recaptcha_token=video_captcha,
            project_id=project_id,
            prompt=prompt_video,
            start_image_media_id=start_media_id,
            end_image_media_id=None,
            aspect=aspect,
            model=video_model,
            tier=None,
            seed=None,
            cookie_header=cookie_header,
            proxy=None,
        ),
        seconds=300,
    )
    result = media_to_result(video_media, "video", project_id)
    result["startImageMediaId"] = start_media_id
    if start_image_result:
        result["imageRaw"] = start_image_result
        result["imageUrl"] = start_image_result.get("mediaUrl", "")
        result["imageMediaId"] = start_image_result.get("mediaId", "")
    result["referenceImageIds"] = reference_image_ids
    if result.get("mediaId") and result.get("workflowId"):
        try:
            trace(
                "Flow bridge: creating scene for video extension",
                projectId=project_id,
                workflowId=result.get("workflowId"),
            )
            scene_data = await with_timeout(
                "Google Flow create scene",
                client.create_scene(
                    access_token=access_token,
                    project_id=project_id,
                    workflow_id=result.get("workflowId"),
                    proxy=None,
                ),
                seconds=60,
            )
            if isinstance(scene_data, (list, tuple)):
                if len(scene_data) > 0:
                    result["sceneId"] = first_text(scene_data[0])
                if len(scene_data) > 1:
                    result["primaryMediaId"] = first_text(scene_data[1])
            elif isinstance(scene_data, dict):
                result["sceneId"] = first_text(scene_data.get("sceneId"), scene_data.get("scene_id"))
                result["primaryMediaId"] = first_text(scene_data.get("primaryMediaId"), scene_data.get("primary_media_id"))
            else:
                result["sceneId"] = first_text(scene_data)
            trace(
                "Flow bridge: scene ready for extension",
                sceneId=result.get("sceneId"),
                primaryMediaId=result.get("primaryMediaId"),
            )
        except Exception as exc:
            result["sceneCreateError"] = str(exc)
            trace("Flow bridge: scene creation failed", error=str(exc))
    result["canExtend"] = bool(result.get("mediaId") and result.get("sceneId"))
    result["refRoot"] = ref_root
    trace("Flow bridge: video generation complete", mediaId=result.get("mediaId"), projectId=project_id, workflowId=result.get("workflowId"))
    return result


def write_json(payload, exit_code=0):
    text = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write((text + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
    if exit_code:
        sys.exit(exit_code)


def main():
    raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    payload = json.loads(raw or "{}")
    try:
        result = asyncio.run(run(payload))
        write_json(result)
    except Exception as exc:
        write_json({"ok": False, "error": str(exc)}, 1)


if __name__ == "__main__":
    main()
