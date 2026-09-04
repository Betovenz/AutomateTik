import argparse
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser(
        description="Test TikTok product flow v2: STEP 8, 8.5, 8.7, and 9.5"
    )
    parser.add_argument(
        "step",
        nargs="?",
        default="all",
        choices=["all", "8", "8.5", "8.7", "9", "9.5"],
        help="Step to test. Use all to run STEP 8 -> 8.5 -> 8.7 -> 9.5.",
    )
    parser.add_argument(
        "--udid",
        default=os.environ.get("ADB_SERIAL", ""),
        help="ADB device UDID. Example: --udid 562eebc0",
    )
    parser.add_argument(
        "--keyword",
        default=os.environ.get("AUTOPOST_VIDEO_NAME") or os.environ.get("AUTOPOST_PRODUCT_NAME") or "TEST",
        help="Keyword for STEP 9.5 search. Default uses AUTOPOST_VIDEO_NAME/AUTOPOST_PRODUCT_NAME or TEST.",
    )
    parser.add_argument(
        "--speed",
        default=os.environ.get("AUTOPOST_SPEED", "fast"),
        choices=["fast", "normal", "slow"],
        help="Pause speed for test actions.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.udid:
        os.environ["ADB_SERIAL"] = args.udid
    os.environ["AUTOPOST_SPEED"] = args.speed
    os.environ["AUTOPOST_VIDEO_NAME"] = args.keyword
    os.environ["AUTOPOST_PRODUCT_NAME"] = args.keyword

    import main as autopost

    driver = autopost.start_driver()
    selected_step = "9.5" if args.step == "9" else args.step

    steps = []
    if selected_step == "all":
        steps = [
            ("8", lambda: autopost.tap_product_link_option(driver)),
            ("8.5", lambda: autopost.tap_add_product_entry_before_search(driver)),
            ("8.7", lambda: autopost.tap_marketplace_option(driver)),
            ("9.5", lambda: autopost.tap_product_viewpager_image(driver, args.keyword)),
        ]
    elif selected_step == "8":
        steps = [("8", lambda: autopost.tap_product_link_option(driver))]
    elif selected_step == "8.5":
        steps = [("8.5", lambda: autopost.tap_add_product_entry_before_search(driver))]
    elif selected_step == "8.7":
        steps = [("8.7", lambda: autopost.tap_marketplace_option(driver))]
    elif selected_step == "9.5":
        steps = [("9.5", lambda: autopost.tap_product_viewpager_image(driver, args.keyword))]

    print(f"UDID: {args.udid or '(default adb device)'}", flush=True)
    print(f"Keyword: {args.keyword}", flush=True)
    print(f"Mode: {selected_step}", flush=True)

    for step_name, action in steps:
        print(f"\nTEST STEP {step_name}: start", flush=True)
        action()
        print(f"TEST STEP {step_name}: success", flush=True)

    print("\nTEST FINISHED", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"\nTEST FAILED: {exc}", file=sys.stderr, flush=True)
        raise
