// Creative-direction option lists (รายละเอียดคลิป) for the generate form + jobs grid.
//
// AutoTik creative-direction catalog — keep the (id, name) pairs in sync
// (same rule as protocol.js/protocol.py). Ported from sora-creator-suite
// (ProductTable.tsx option constants + grok VIDEO_STYLES). Loaded BEFORE app.js.
//
// Each list is [id, ThaiName] pairs. The Python side resolves the same ids when it
// folds the picks into the prompt; the UI uses them for the dropdowns and the grid
// chips. Besides these presets, every field also offers a "กำหนดเอง" (custom) option:
// the operator types their own text, stored/sent as `custom:<text>` (see CUSTOM_PREFIX
// below — mirrors style_options.CUSTOM_PREFIX / MAX_CUSTOM_DIRECTION_LEN).
(function () {
  window.STYLE_OPTIONS = {
    videoStyle: [
      ["default", "AI เลือกให้"],
      ["silent-product", "ถือสินค้า (ไม่พูด)"],
      ["factory-line", "โรงงานผลิต"],
      ["department-store", "ห้างสรรพสินค้า"],
      ["department-store-holding", "ถือสินค้าในห้างสรรพสินค้า"],
      ["warehouse", "โกดัง"],
      ["warehouse-holding", "ถือสินค้าในโกดัง"],
      ["dance", "เต้น"],
      ["beach", "ทะเล"],
      ["summer", "Summer"],
      ["songkran", "สงกรานต์"],
      ["sampheng", "ตลาดสำเพ็ง"],
      ["fancy", "ของลอย"],
      ["authentic", "ใช้งานจริง"],
      ["promotional", "โปรโมท"],
      ["bobblehead", "หัวโต"],
      ["review", "ถือสินค้า"],
      ["live-commerce", "ไลฟ์สด"],
      ["cgi-giant", "CGI สินค้ายักษ์"],
      ["cartoon-3d", "การ์ตูน 3D"],
      ["asmr", "ASMR"],
      ["luxury", "Luxury"],
      ["vlog", "Vlog"],
      ["reaction", "Reaction"],
      ["model", "นายแบบ"],
      ["influencer", "อินฟลูฯ"],
      ["macro", "เนื้อสัมผัส"],
      ["unboxing", "แกะกล่อง"],
      ["mirror-selfie", "หน้ากระจก"],
      ["fashion", "แฟชั่น"],
      ["beauty", "บิวตี้"],
      ["shoes", "รองเท้า"],
      ["furniture", "ของใหญ่"],
      ["tools", "เครื่องมือ"],
    ],
    character: [
      ["young-woman", "สาวสวยยิ้มแย้ม"],
      ["young-man", "หนุ่มหล่อมั่นใจ"],
      ["middle-woman", "ผู้หญิงวัยกลางคน"],
      ["middle-man", "ผู้ชายวัยกลางคน"],
      ["cheerful-girl", "เด็กสาวร่าเริง"],
      ["energetic-guy", "เด็กหนุ่มกระตือรือร้น"],
      ["professional-woman", "นักธุรกิจหญิง"],
      ["professional-man", "นักธุรกิจชาย"],
      ["friendly-mom", "แม่บ้านอบอุ่น"],
      ["cool-dad", "พ่อบ้านเท่ๆ"],
      ["trendy-teen-girl", "วัยรุ่นหญิงทันสมัย"],
      ["trendy-teen-boy", "วัยรุ่นชายทันสมัย"],
      ["elder-woman", "ผู้หญิงสูงวัย"],
      ["elder-man", "ผู้ชายสูงวัย"],
      ["influencer", "อินฟลูเอนเซอร์"],
    ],
    background: [
      ["living-room", "ห้องนั่งเล่นสบายๆ แสงธรรมชาติ"],
      ["garden", "สวนหลังบ้าน บรรยากาศร่มรื่น"],
      ["cafe", "ร้านกาแฟน่านั่ง"],
      ["bedroom", "ห้องนอนอบอุ่น"],
      ["balcony", "ระเบียงบ้าน วิวสวย"],
      ["kitchen", "ครัวสะอาด สว่าง"],
      ["office", "ออฟฟิศทันสมัย"],
      ["beach", "ริมชายหาด ฟ้าสวย"],
      ["park", "สวนสาธารณะ ท้องฟ้าใส"],
      ["shopping-mall", "ห้างสรรพสินค้า"],
      ["rooftop", "ดาดฟ้าวิวเมือง"],
      ["studio", "สตูดิโอถ่ายรูป"],
      ["restaurant", "ร้านอาหารหรูหรา"],
      ["gym", "ฟิตเนสสมัยใหม่"],
      ["library", "ห้องสมุดเงียบสงบ"],
      ["home-office-minimal", "โฮมออฟฟิศสไตล์มินิมอล"],
      ["modern-living", "ห้องรับแขกโมเดิร์น"],
      ["japanese-workspace", "ห้องทำงานสไตล์ญี่ปุ่น"],
      ["reading-corner", "มุมอ่านหนังสือริมหน้าต่าง"],
      ["vintage-cafe", "คาเฟ่วินเทจบรรยากาศดี"],
      ["loft-kitchen", "ห้องครัวโมเดิร์นสไตล์ลอฟท์"],
      ["minimal-bedroom", "ห้องนอนมินิมอลสีขาว"],
      ["poolside-resort", "ริมสระน้ำบรรยากาศรีสอร์ท"],
      ["white-sand-beach", "หาดทรายขาวน้ำทะเลใส"],
      ["mountain-view", "ภูเขาวิวสวย"],
      ["forest", "ป่าไม้บรรยากาศร่มรื่น"],
      ["flower-garden", "สวนดอกไม้สีสันสดใส"],
      ["showroom", "โชว์รูมสินค้าทันสมัย"],
      ["luxury-hotel", "โรงแรมหรูบรรยากาศดี"],
      ["spa", "สปาผ่อนคลาย"],
    ],
    speakingStyle: [
      ["Enthusiastic", "ตื่นเต้น"],
      ["Professional", "มืออาชีพ"],
      ["Friendly", "เป็นมิตร"],
      ["Energetic", "มีพลัง"],
      ["Calm", "สงบ"],
      ["Persuasive", "โน้มน้าว"],
      ["Humorous", "ตลกขบขัน"],
      ["Informative", "ให้ข้อมูล"],
      ["Dramatic", "ดราม่า"],
      ["Casual", "สบายๆ"],
      ["Rapper", "แร็พเปอร์"],
    ],
    voiceType: [
      ["male-teen", "ชายวัยรุ่น"],
      ["male-young", "ชายหนุ่ม"],
      ["male-adult", "ชายวัยกลางคน"],
      ["male-elder", "ชายสูงอายุ"],
      ["male-deep", "ชายเสียงทุ้ม"],
      ["male-high", "ชายเสียงสูง"],
      ["male-energetic", "ชายกระตือรือร้น"],
      ["male-calm", "ชายเสียงนุ่มสุขุม"],
      ["male-presenter", "พิธีกรชาย"],
      ["male-narrator", "นักพากย์ชาย"],
      ["female-teen", "หญิงวัยรุ่น"],
      ["female-young", "หญิงสาว"],
      ["female-adult", "หญิงวัยกลางคน"],
      ["female-elder", "หญิงสูงอายุ"],
      ["female-sweet", "หญิงเสียงหวาน"],
      ["female-clear", "หญิงเสียงใส"],
      ["female-energetic", "หญิงกระตือรือร้น"],
      ["female-soft", "หญิงเสียงนุ่มนวล"],
      ["female-presenter", "พิธีกรหญิง"],
      ["female-narrator", "นักพากย์หญิง"],
    ],
    speechContentStyle: [
      ["promo-explain", "สายบอกโปร"],
      ["decision-push", "เน้นการตัดสินใจ"],
      ["product-story", "เล่าสินค้า"],
      ["detailed", "พูดรายละเอียด"],
      ["isan", "พูดอีสาน"],
    ],
  };

  // Ordered [optionKey, formLabel] — drives both the form dropdowns (in order) and
  // the jobs-grid chips. Mirrors style_options.DIRECTION_FIELDS (which carries the
  // Thai *prompt* labels; here the labels are the form's field captions).
  window.DIRECTION_FIELDS = [
    ["videoStyle", "Video Style"],
    ["character", "Character"],
    ["background", "Background"],
    ["speakingStyle", "Speaking Style"],
    ["voiceType", "ลักษณะเสียง"],
    ["speechContentStyle", "สไตล์บทพูด"],
  ];

  // Free-text "custom" direction values — mirror of style_options.CUSTOM_PREFIX /
  // MAX_CUSTOM_DIRECTION_LEN. An operator picks "กำหนดเอง" and types their own text,
  // stored/sent as `custom:<text>`. All six fields offer it.
  window.CUSTOM_PREFIX = "custom:";
  window.MAX_CUSTOM_DIRECTION_LEN = 300;
  window.CUSTOM_DIRECTION_FIELDS = window.DIRECTION_FIELDS.map((pair) => pair[0]);
  window.isCustomValue = function (v) {
    return typeof v === "string" && v.indexOf(window.CUSTOM_PREFIX) === 0;
  };
  window.customValueText = function (v) {
    return window.isCustomValue(v) ? v.slice(window.CUSTOM_PREFIX.length).trim() : "";
  };

  // Resolve a stored id to its Thai display name. A `custom:<text>` value renders as the
  // typed text; an unknown id falls back to the raw value.
  window.styleLabel = function (field, id) {
    if (window.isCustomValue(id)) return window.customValueText(id);
    const hit = (window.STYLE_OPTIONS[field] || []).find((pair) => pair[0] === id);
    return hit ? hit[1] : id;
  };
})();
