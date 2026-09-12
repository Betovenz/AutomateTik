(function rebuildAutoGTProShell() {
  'use strict';

  const legacyTikTokMain = document.querySelector('[data-mode-page="tiktok-shop"] .tiktok-content');
  const legacyShopeeMain = document.querySelector('[data-mode-page="shopee-shop"] .tiktok-content');
  const legacyGenericMain = document.querySelector('[data-mode-page="generic"] .blank-main');

  if (!legacyTikTokMain || !legacyShopeeMain || !legacyGenericMain) {
    console.error('[ui-shell] Required functional panels were not found.');
    return;
  }

  legacyTikTokMain.classList.add('platform-main', 'platform-main-tiktok');
  legacyShopeeMain.classList.add('platform-main', 'platform-main-shopee');
  legacyGenericMain.classList.add('platform-main', 'platform-main-generic');

  document.querySelector('body > main.page')?.remove();
  document.querySelector('body > header.topbar')?.remove();
  document.querySelector('body > footer.footer')?.remove();

  const template = document.createElement('template');
  template.innerHTML = `
    <section class="start-view" data-view="home">
      <div class="start-view__inner">
        <div class="start-brand" aria-label="AutoTik AI Studio">
          <span class="start-brand__mark">AT</span>
          <span><strong>AutoTik <em>AI Studio</em></strong><small>Automation Studio</small></span>
        </div>
        <div class="start-copy">
          <p class="eyebrow">AUTOMATION WORKSPACE</p>
          <h1>เลือกพื้นที่ทำงาน</h1>
          <p>จัดการสินค้า สร้างวิดีโอ และเผยแพร่คอนเทนต์จากหน้าจอเดียว</p>
        </div>
        <div class="start-modes">
          <button type="button" class="start-mode" data-route="tiktok-shop">
            <span class="material-symbols-outlined">music_note</span>
            <span><strong>TikTok Shop</strong><small>Showcase, AI video และการโพสต์</small></span>
            <span class="material-symbols-outlined">arrow_forward</span>
          </button>
          <button type="button" class="start-mode" data-route="shopee-shop">
            <span class="material-symbols-outlined">shopping_bag</span>
            <span><strong>Shopee Shop</strong><small>ค้นหาสินค้า รีวิว และงาน Affiliate</small></span>
            <span class="material-symbols-outlined">arrow_forward</span>
          </button>
          <button type="button" class="start-mode" data-route="adb-connect">
            <span class="material-symbols-outlined">android</span>
            <span><strong>ADB Connect</strong><small>จัดการอุปกรณ์ Android</small></span>
            <span class="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
        <footer class="start-footer">
          <span>&copy; 2026 AutoTik</span>
          <span>Quiet automation workspace</span>
        </footer>
      </div>
    </section>

    <section class="autogt-app" data-view="mode" hidden>
      <header class="app-topbar">
        <button class="app-brand" type="button" data-route="home" aria-label="กลับหน้าหลัก">
          <span class="app-brand__mark">AT</span>
          <span class="app-brand__name">AutoTik <em>AI Studio</em></span>
          <span class="app-brand__badge">BETA</span>
        </button>

        <nav class="mode-tabs" aria-label="เมนูหลัก">
          <button type="button" data-route="tiktok-shop">
            <span class="material-symbols-outlined">music_note</span>TikTok Shop
          </button>
          <button type="button" data-route="shopee-shop">
            <span class="material-symbols-outlined">shopping_bag</span>Shopee Shop
          </button>
          <button type="button" data-route="adb-connect">
            <span class="material-symbols-outlined">android</span>ADB Connect
          </button>
        </nav>

        <div class="topbar-spacer"></div>
        <div class="extension-pill" data-extension-status="offline">
          <span class="extension-pill__label">Extension</span>
          <span class="extension-pill__state"><i class="status-dot"></i><b data-extension-label>Offline</b></span>
        </div>
        <label class="serial-control">
          <span>Serial Number</span>
          <input type="text" data-serial-input placeholder="AGT-********" autocomplete="off">
        </label>
        <button type="button" class="activate-button" data-serial-activate>Activate</button>
        <span class="license-state" data-serial-state>Inactive</span>
        <button type="button" class="icon-button" title="การแจ้งเตือน" aria-label="การแจ้งเตือน">
          <span class="material-symbols-outlined">notifications</span>
        </button>
        <button type="button" class="icon-button" title="ช่วยเหลือ" aria-label="ช่วยเหลือ">
          <span class="material-symbols-outlined">help</span>
        </button>
        <button type="button" class="icon-button" data-route="settings" title="ตั้งค่า" aria-label="ตั้งค่า">
          <span class="material-symbols-outlined">settings</span>
        </button>
        <span class="profile-avatar" aria-label="ผู้ใช้งาน">A</span>
      </header>

      <div class="app-frame">
        <aside class="app-sidebar">
          <div class="sidebar-context">
            <span class="sidebar-context__mode" id="modeEyebrow">TIKTOK MODE</span>
            <h2 id="modeTitle">TikTok Shop</h2>
            <p id="modeDesc">Automation workspace</p>
          </div>
          <nav class="side-nav" aria-label="เมนูฟังก์ชัน"></nav>
          <nav class="side-nav side-bottom" aria-label="เมนูระบบ">
            <span class="side-section-label">SYSTEM</span>
            <button type="button" data-open-logs><span class="material-symbols-outlined">article</span><span class="side-nav-label">Logs</span></button>
            <button type="button" data-route="downloads"><span class="material-symbols-outlined">download</span><span class="side-nav-label">Downloads</span></button>
            <button type="button" data-route="channel"><span class="material-symbols-outlined">account_circle</span><span class="side-nav-label">Channel</span></button>
            <button type="button" data-route="settings"><span class="material-symbols-outlined">settings</span><span class="side-nav-label">Settings</span></button>
          </nav>
          <div class="system-health extension-sidebar-status" data-extension-status="offline" title="AutoTik Extension v0.1.0 beta offline">
            <span><i class="status-dot"></i>AutoTik Extension</span>
            <strong data-extension-label>AutoTik Extension v0.1.0 beta offline</strong>
          </div>
        </aside>

        <main class="app-content">
          <div class="route-meta" aria-hidden="true"><span id="routeMetaTitle"></span></div>
          <section class="mode-page mode-page-tiktok" data-mode-page="tiktok-shop"></section>
          <section class="mode-page mode-page-shopee" data-mode-page="shopee-shop" hidden></section>
          <section class="mode-page mode-page-generic" data-mode-page="generic" hidden></section>
        </main>
      </div>
    </section>
  `;

  document.body.prepend(template.content);
  document.querySelector('[data-mode-page="tiktok-shop"]').append(legacyTikTokMain);
  document.querySelector('[data-mode-page="shopee-shop"]').append(legacyShopeeMain);
  document.querySelector('[data-mode-page="generic"]').append(legacyGenericMain);

  const routePanels = [
    'channelPage',
    'shopeeProductSearchPanel',
    'shopeeRemixPanel',
    'mobilePostPanel',
    'adbDevicePanel'
  ].map((id) => document.getElementById(id)).filter(Boolean);

  document.querySelectorAll('[data-flow-workbench]').forEach((panel) => {
    panel.classList.add('route-panel', 'route-panel-flow');
    panel.hidden = true;
    routePanels.push(panel);
  });

  routePanels.forEach((panel) => {
    panel.classList.add('route-panel');
    panel.hidden = true;
  });

  function makeWorkspaceHeading(eyebrow, title, description, className = '') {
    const heading = document.createElement('header');
    heading.className = `workspace-heading ${className}`.trim();
    heading.innerHTML = `
      <div>
        <p class="workspace-eyebrow">${eyebrow}</p>
        <h1>${title}</h1>
        <p class="workspace-description">${description}</p>
      </div>
    `;
    return heading;
  }

  function makeWorkspaceColumn(className) {
    const column = document.createElement('div');
    column.className = `workspace-column ${className}`;
    return column;
  }

  function migrateShowcase(workbench, platformLabel) {
    if (!workbench || workbench.dataset.uiMigrated === 'true') return;

    const heading = workbench.querySelector(':scope > .mode-topline');
    const sourcePanel = workbench.querySelector(':scope > .showcase-loader-panel');
    const resultsPanel = workbench.querySelector(':scope > .results-section');
    if (!heading || !sourcePanel || !resultsPanel) return;

    workbench.classList.add('ui-showcase-route');
    heading.classList.add('workspace-heading', 'showcase-heading');
    sourcePanel.classList.add('workspace-panel', 'showcase-source-panel');
    resultsPanel.classList.add('workspace-panel', 'showcase-results-panel');
    resultsPanel.dataset.platform = platformLabel;
    resultsPanel.hidden = false;

    const layout = document.createElement('div');
    layout.className = 'showcase-layout';
    layout.append(sourcePanel, resultsPanel);
    workbench.replaceChildren(heading, layout);
    workbench.dataset.uiMigrated = 'true';
  }

  // ---- flow-suite: BlueSPite-ported Prompt/Queue/History pages ----
  // Built entirely from scratch (no legacy markup migration) — see the port
  // plan (C:\Users\Blue\.claude\plans\joyful-humming-kazoo.md, Stage 9). All
  // 3 pages are driven by app.js's flow-suite SSE state cache, not by route
  // navigation, so their DOM co-exists at all times; only CSS visibility
  // (body[data-flow-page] .flow-page-*) toggles which one is shown.
  function buildFlowPromptPage() {
    const page = document.createElement('section');
    page.className = 'flow-page flow-page-prompt';
    page.dataset.flowPage = 'prompt';
    const heading = makeWorkspaceHeading(
      'AI VIDEO WORKSPACE',
      'ตั้งค่า Prompt',
      'ตั้งค่านี้ครั้งเดียว ใช้กับทุกสินค้าที่ส่งเข้าคิวจากหน้า Showcase — บันทึกอัตโนมัติทุกครั้งที่เปลี่ยนค่า',
      'flow-workspace-heading'
    );
    const saveBar = document.createElement('div');
    saveBar.className = 'fs-row fs-end';
    saveBar.style.marginBottom = '10px';
    saveBar.innerHTML = `<button id="fsSaveSettingsBtn" class="fs-btn fs-primary" type="button">💾 บันทึกการตั้งค่า</button>`;

    const split = document.createElement('div');
    split.className = 'fs-split';
    split.innerHTML = `
      <div class="fs-col">
        <div class="fs-card fs-column">
          <strong>1. รายละเอียดคลิป</strong>
          <div class="fs-direction-grid" id="fsDirectionGrid"></div>
          <div class="fs-direction-grid">
            <div class="fs-field">
              <label for="fsCharacterMode">หน้าตัวละคร</label>
              <select id="fsCharacterMode">
                <option value="random">สุ่มตัวละคร (แบบเก่า ไม่สร้างภาพตัวละคร)</option>
                <option value="consistent">ใช้ตัวละครตัวเดียวกัน (สร้างภาพตัวละครก่อน)</option>
              </select>
              <small class="fs-muted">ค่าเริ่มต้น: สุ่มตัวละคร</small>
            </div>
          </div>
        </div>
        <div class="fs-card fs-column">
          <strong>2. โมเดลและขนาด</strong>
          <div class="fs-spec-grid">
            <div class="fs-field">
              <label for="fsVideoModel">โมเดลวิดีโอ</label>
              <select id="fsVideoModel"></select>
              <small id="fsVideoModelNote" class="fs-muted"></small>
            </div>
            <div class="fs-field">
              <label for="fsImageModel">โมเดลภาพ (ใช้เมื่อมีข้อความในวิดีโอ)</label>
              <select id="fsImageModel"></select>
            </div>
            <div class="fs-field">
              <label for="fsAspect">ขนาด</label>
              <select id="fsAspect"></select>
            </div>
            <div class="fs-field" data-flow-extended-control hidden>
              <label for="fsSceneMode">วิธีเพิ่มฉาก</label>
              <select id="fsSceneMode">
                <option value="independent">ไม่ต่อเนื่อง (แบบปัจจุบัน)</option>
                <option value="continuous">ต่อเนื่อง (Extended)</option>
              </select>
              <small id="fsSceneModeNote" class="fs-muted"></small>
            </div>
            <div class="fs-field">
              <label for="fsSceneCount">จำนวนฉาก</label>
              <input type="number" id="fsSceneCount" min="1" max="10" step="1" value="1" />
            </div>
            <div class="fs-field">
              <label for="fsTextMode">ข้อความในวิดีโอ</label>
              <select id="fsTextMode"></select>
            </div>
            <div class="fs-field">
              <label for="fsConcurrency">จำนวนคิวพร้อมกัน</label>
              <input type="number" id="fsConcurrency" min="1" max="150" step="1" value="1" />
              <small id="fsConcurrencyNote" class="fs-muted"></small>
            </div>
          </div>
        </div>
        <div class="fs-card fs-column">
          <div class="fs-mandatory-prompt-head">
            <strong>3. Prompt บังคับใช้</strong>
            <span id="fsMandatoryPromptState" class="fs-scene-prompt-state" data-state="default">Default ปัจจุบัน</span>
            <button id="fsResetMandatoryPrompt" class="fs-btn fs-ghost fs-scene-prompt-reset" type="button">↶ กลับ Default</button>
          </div>
          <p class="fs-muted fs-scene-prompt-help">Prompt นี้จะถูกใส่ในทุกฉาก เปลี่ยนครั้งเดียวมีผลกับทุกฉาก และกลับมาใช้ค่า Default ของระบบได้เสมอ</p>
          <textarea id="fsExtraPrompt" rows="6" maxlength="5000" placeholder="Prompt บังคับใช้สำหรับทุกฉาก"></textarea>
        </div>
        <div class="fs-card fs-column">
          <strong>4. คำสั่งวิดีโอรายฉาก</strong>
          <p class="fs-muted fs-scene-prompt-help">แก้คำสั่งของแต่ละฉากได้โดยตรง ข้อความนี้จะแทนส่วนคำสั่งฉาก ส่วนข้อมูลสินค้า บทพูด และข้อห้ามยังประกอบให้อัตโนมัติ กด “กลับ Default” เพื่อใช้ Prompt ปัจจุบันของระบบได้เสมอ</p>
          <div id="fsSceneVideoPrompts" class="fs-scene-prompt-grid"></div>
          <div class="fs-scene-prompt-save-row">
            <button id="fsApplyScenePromptsBtn" class="fs-btn fs-primary" type="button">💾 บันทึก Prompt และดู Preview</button>
            <span id="fsApplyScenePromptsStatus" class="fs-muted" aria-live="polite"></span>
          </div>
        </div>
      </div>
      <div class="fs-col">
        <div class="fs-card fs-column fs-sticky">
          <div class="fs-row" style="justify-content: space-between; align-items: center;">
            <strong>ตัวอย่าง Prompt</strong>
            <div class="fs-row fs-preview-actions">
              <button id="fsTemplateBtn" class="fs-btn fs-ghost" type="button">โครง Prompt (-)</button>
              <button id="fsSampleBtn" class="fs-btn fs-ghost" type="button" title="สุ่มสินค้าจริงมาดูตัวอย่าง">🎲 สินค้าจริง</button>
            </div>
          </div>
          <p class="fs-muted">แสดง Prompt ที่จะใช้จริงตามค่าด้านซ้าย ข้อมูลที่ต้องดึงจากสินค้าจะแทนด้วย - และเลือกตรวจแยกแต่ละฉากได้</p>
          <div id="fsSampleBox" class="fs-sample-box"></div>
        </div>
      </div>
    `;
    page.append(heading, saveBar, split);
    return page;
  }

  function buildFlowQueuePage() {
    const page = document.createElement('section');
    page.className = 'flow-page flow-page-queue';
    page.dataset.flowPage = 'queue';
    const heading = makeWorkspaceHeading(
      'AI VIDEO WORKSPACE',
      'คิว',
      'รันทีละงานโดยตั้งใจ — ยิงพร้อมกันหลายงาน Flow จะมองว่าเป็นบอท',
      'flow-workspace-heading'
    );
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div class="fs-toolbar">
        <span id="fsQueueCounts"></span>
        <button id="fsRunQueue" class="fs-btn fs-primary" type="button" disabled>▶ รันคิว</button>
        <button id="fsStopQueue" class="fs-btn fs-ghost" type="button" disabled>■ หยุดคิว</button>
        <button id="fsClearQueued" class="fs-btn fs-ghost fs-danger" type="button" hidden>ล้างงานรอคิว</button>
        <button id="fsClearJobs" class="fs-btn fs-ghost fs-danger" type="button" hidden>ล้างงานที่สำเร็จ</button>
        <button id="fsClearFailed" class="fs-btn fs-ghost fs-danger" type="button" hidden>ล้างงานที่ล้มเหลว</button>
        <button id="fsClearCancelled" class="fs-btn fs-ghost fs-danger" type="button" hidden>ล้างงานที่ยกเลิก</button>
        <button id="fsRetryAllFailed" class="fs-btn fs-ghost" type="button" hidden>ลองงานที่ล้มเหลวทั้งหมด</button>
        <label class="fs-switch-row" for="fsAutoPlay">
          <span class="fs-switch">
            <input type="checkbox" id="fsAutoPlay">
            <span class="fs-switch-slider"></span>
          </span>
          <span>เริ่มคิวอัตโนมัติเมื่อส่งงานเข้าคิว</span>
        </label>
      </div>
      <div id="fsJobList" class="fs-results"></div>
      <div id="fsQueuePager" class="fs-pager" hidden></div>
    `;
    page.append(heading, panel);
    return page;
  }

  function buildFlowHistoryPage() {
    const page = document.createElement('section');
    page.className = 'flow-page flow-page-history';
    page.dataset.flowPage = 'history';
    const heading = makeWorkspaceHeading(
      'AI VIDEO WORKSPACE',
      'ประวัติ',
      'สรุปทุกงานสร้างวิดีโอที่เคยรัน — สำเร็จ ไม่สำเร็จ หรือยกเลิก',
      'flow-workspace-heading'
    );
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div class="fs-toolbar fs-mode-toggle" id="fsHistoryFilter">
        <button type="button" data-filter="all" class="fs-on">ทั้งหมด</button>
        <button type="button" data-filter="done">สำเร็จ</button>
        <button type="button" data-filter="failed">ล้มเหลว</button>
        <button type="button" data-filter="cancelled">ยกเลิก</button>
      </div>
      <div class="fs-toolbar" id="fsHistoryClearBar">
        <span class="fs-muted">ลบเฉพาะคอลัมน์ (ไม่มีลบทั้งหมด):</span>
        <button type="button" class="fs-btn fs-ghost fs-danger" data-clear="done">ลบงานที่สำเร็จ</button>
        <button type="button" class="fs-btn fs-ghost fs-danger" data-clear="failed">ลบงานที่ล้มเหลว</button>
        <button type="button" class="fs-btn fs-ghost fs-danger" data-clear="cancelled">ลบงานที่ยกเลิก</button>
      </div>
      <div id="fsHistoryList" class="fs-results"></div>
    `;
    page.append(heading, panel);
    return page;
  }

  function migrateFlowWorkbench() {
    const workbench = document.querySelector('[data-flow-workbench]');
    if (!workbench || workbench.dataset.uiMigrated === 'true') return;

    workbench.classList.add('ui-flow-route');
    const promptPage = buildFlowPromptPage();
    const queuePage = buildFlowQueuePage();
    const historyPage = buildFlowHistoryPage();

    // Deliberately replaces ALL prior children — the old Queue Items/Prompt
    // Setting/Queue Process legacy markup this used to reorganize in place is
    // dropped here rather than kept around hidden. Its JS (old renderFlow*
    // functions in app.js) still exists until the Stage 10 cutover, but with
    // no DOM anchors left to query it safely becomes inert instead of firing.
    workbench.replaceChildren(promptPage, queuePage, historyPage);
    workbench.dataset.uiMigrated = 'true';
  }

  function migrateMobileWorkbench() {
    const workbench = document.getElementById('mobilePostPanel');
    if (!workbench || workbench.dataset.uiMigrated === 'true') return;

    const main = workbench.querySelector('.mobile-main-column');
    const side = workbench.querySelector('.mobile-side-column');
    if (!main || !side) return;

    workbench.classList.add('ui-mobile-route');

    const heading = makeWorkspaceHeading(
      'ADB MOBILE AUTOMATION',
      'Post TikTok (มือถือ)',
      'จัดการอุปกรณ์ ช่องทาง วิดีโอ และกำหนดเวลาสำหรับการโพสต์ผ่าน Android',
      'mobile-workspace-heading'
    );
    const layout = document.createElement('div');
    layout.className = 'mobile-workspace-layout';
    main.classList.add('workspace-column');
    side.classList.add('workspace-column');
    layout.append(main, side);
    workbench.replaceChildren(heading, layout);
    workbench.dataset.uiMigrated = 'true';
  }

  migrateShowcase(legacyTikTokMain, 'TikTok');
  migrateShowcase(legacyShopeeMain, 'Shopee');
  migrateFlowWorkbench();
  migrateMobileWorkbench();

  document.documentElement.classList.add('autogt-ui-v2');
})();
