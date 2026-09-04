// ประกอบรายงานประวัติการทำรายการเป็น HTML สำหรับเรนเดอร์เป็น PDF
//
// ย้ายมาจากฝั่งเบราว์เซอร์ (src/utils/reportPrint.js) เพราะ iOS Safari สั่งพิมพ์แล้ว
// เข้า AirPrint เสมอ บันทึกเป็นไฟล์ไม่ได้ — ให้เซิร์ฟเวอร์เรนเดอร์แล้วส่งเป็นไฟล์แนบแทน
//
// ทำไมไม่ใช้ไลบรารีสร้าง PDF โดยตรง: jsPDF ไม่อ่านตาราง GPOS ของฟอนต์ จึงไม่จัดตำแหน่ง
// สระ/วรรณยุกต์ไทย วัดกับไฟล์จริงแล้วได้ "ที่"→"ที" และ "ปุ่ม"→"ปุม"
// เบราว์เซอร์จัดให้ถูกอยู่แล้ว จึงยืมความสามารถนั้นมาใช้
//
// แบ่งหน้าเองแทนที่จะปล่อยให้เบราว์เซอร์แบ่ง เพราะ Chrome ใส่เลขหน้าใน CSS ไม่ได้
// (ไม่รองรับ @page margin box) การกำหนดจำนวนแถวต่อหน้าเองจึงเป็นทางเดียวที่ทำให้
// "หน้า X จาก Y" ตรงความจริง

const ROWS_PER_PAGE = 10;          // แถวมีรูปสินค้า สูงประมาณ 16mm
const SUMMARY_ROWS_PER_PAGE = 22;  // ตารางสรุปไม่มีรูป แถวจึงเตี้ยกว่า

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const styles = (fontBase64) => `
  @font-face {
    font-family: 'SarabunPrint';
    src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
    font-weight: 400;
    font-style: normal;
  }
  /* margin 0 แล้วคุมขอบด้วย padding ของ .page เอง จะได้คำนวณความสูงที่เหลือได้แน่นอน */
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'SarabunPrint', 'Leelawadee UI', Tahoma, sans-serif; color: #142846; }

  .page {
    width: 297mm;
    /* เตี้ยกว่า 210mm เล็กน้อย กัน Chrome แทรกหน้าเปล่าเพราะเนื้อหาสูงพอดีขอบ */
    height: 209.4mm;
    padding: 9mm 8mm 7mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  h1 { margin: 0; font-size: 13pt; text-align: center; color: #142846; }
  h1.summary { color: #107a57; }
  .sub { margin: 2mm 0 3mm; font-size: 8pt; text-align: center; color: #6e6e6e; }
  .foot { margin-top: auto; font-size: 8pt; text-align: right; color: #6e6e6e; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.2mm solid #c9d6e4; padding: 1mm 1.2mm; font-size: 8pt; vertical-align: middle; word-wrap: break-word; }
  th { background: #2563eb; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #f1f7fd; }
  td.img { text-align: center; padding: 0.6mm; }
  td.img img { width: 13mm; height: 13mm; object-fit: contain; display: block; margin: 0 auto; }
  td.num { text-align: center; }
  tbody td { height: 15mm; }

  .summary th { background: #107a57; }
  .summary tbody tr:nth-child(even) td { background: #edf7f2; }
  .summary tbody td { height: auto; }
`;

const MAIN_HEAD = ['วันที่-เวลา', 'รหัสใบรายการ', 'ประเภท', 'รูป', 'SKU', 'หมวดหมู่', 'ชื่อสินค้า', 'จำนวน', 'ผู้ทำรายการ', 'โปรเจกต์', 'สถานะ', 'หมายเหตุ'];
const MAIN_WIDTHS = ['8%', '9%', '6%', '6%', '6%', '11%', '16%', '5%', '9%', '8%', '7%', '9%'];

// รูปอ้างเป็น URL ปกติ (/uploads/...) ไม่ฝัง base64 — Chrome โหลดจากเซิร์ฟเวอร์ตัวเองผ่าน HTTP
// ทำให้ HTML ไม่บวมและไม่ต้องมีไลบรารีย่อรูปฝั่งเซิร์ฟเวอร์
const mainRowHtml = (row) => `
  <tr>
    <td>${esc(row.date)}</td>
    <td>${esc(row.txId)}</td>
    <td>${esc(row.type)}</td>
    <td class="img">${row.imageUrl ? `<img src="${esc(row.imageUrl)}" alt="">` : ''}</td>
    <td>${esc(row.sku)}</td>
    <td>${esc(row.group)}</td>
    <td>${esc(row.name)}</td>
    <td class="num">${esc(row.qty)}</td>
    <td>${esc(row.requester)}</td>
    <td>${esc(row.project)}</td>
    <td>${esc(row.status)}</td>
    <td>${esc(row.note)}</td>
  </tr>`;

// ย่อรูปก่อนพิมพ์ — ในรายงานรูปแสดงแค่ 13mm แต่ไฟล์ต้นฉบับใหญ่ 100-200 KB
// ถ้าปล่อยไว้ รายงานรายเดือน 90 แถวจะได้ไฟล์ ~11 MB ซึ่งโหลดบนมือถือช้ามาก
// ให้เบราว์เซอร์ที่กำลังเรนเดอร์ย่อเองผ่าน canvas (รูปมาจาก origin เดียวกัน canvas จึงไม่ถูกล็อก)
// ถ้าย่อไม่สำเร็จก็ยังได้รูปเต็มตามเดิม รายงานไม่พัง แค่ไฟล์ใหญ่กว่า
const SHRINK_SCRIPT = `<script>
(async () => {
  const TARGET = 160;   // px — คมพอสำหรับ 13mm บนกระดาษ
  await Promise.all([...document.images].map((img) => new Promise((done) => {
    const run = () => {
      try {
        const side = Math.max(img.naturalWidth, img.naturalHeight);
        if (!side || side <= TARGET) return done();
        const scale = TARGET / side;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = canvas.toDataURL('image/jpeg', 0.8);
        img.onload = () => done();
      } catch { done(); }
    };
    if (img.complete) run(); else { img.onload = run; img.onerror = () => done(); }
  })));
  document.documentElement.dataset.ready = '1';
})();
</script>`;

/**
 * ประกอบรายงานเป็น HTML พร้อมเลขหน้าที่ตรงความจริง
 *
 * @param {object} report
 * @param {Array}  report.rows         แถวรายการสินค้า
 * @param {Array}  report.summaryRows  [sku, ชื่อ, รับเข้า, เบิกออก]
 * @param {string} report.periodLabel  ข้อความช่วงเวลา/ตัวกรอง
 * @param {number} report.txCount      จำนวนใบรายการ
 * @param {string} report.fontBase64   ฟอนต์ไทย base64
 * @param {string} report.filename     ใช้เป็น <title>
 * @returns {{ html: string, pages: number }}
 */
export const buildReportHtml = ({ rows, summaryRows, periodLabel, txCount, fontBase64, filename }) => {
  const mainPages = chunk(rows, ROWS_PER_PAGE);
  const summaryPages = summaryRows.length > 0 ? chunk(summaryRows, SUMMARY_ROWS_PER_PAGE) : [];
  const total = mainPages.length + summaryPages.length;
  const printedAt = new Date().toLocaleString('th-TH');

  const colgroup = `<colgroup>${MAIN_WIDTHS.map((w) => `<col style="width:${w}">`).join('')}</colgroup>`;

  let pageNo = 0;
  const mainHtml = mainPages.map((pageRows) => {
    pageNo += 1;
    return `
      <section class="page">
        <h1>รายงานประวัติการทำรายการคลังสินค้า (WMS)</h1>
        <p class="sub">${esc(periodLabel)} · ออกรายงานเมื่อ ${esc(printedAt)} · ${txCount} ใบรายการ</p>
        <table>
          ${colgroup}
          <thead><tr>${MAIN_HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${pageRows.map(mainRowHtml).join('')}</tbody>
        </table>
        <p class="foot">หน้า ${pageNo} จาก ${total}</p>
      </section>`;
  }).join('');

  const summaryHtml = summaryPages.map((pageRows) => {
    pageNo += 1;
    return `
      <section class="page">
        <h1 class="summary">สรุปยอดรวมต่อสินค้า</h1>
        <p class="sub">${esc(periodLabel)} · รวม ${summaryRows.length} รายการสินค้า</p>
        <table class="summary">
          <colgroup><col style="width:14%"><col style="width:56%"><col style="width:15%"><col style="width:15%"></colgroup>
          <thead><tr>${['SKU', 'ชื่อสินค้า', 'รับเข้ารวม (ชิ้น)', 'เบิกออกรวม (ชิ้น)'].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${pageRows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${esc(r[2])}</td><td class="num">${esc(r[3])}</td></tr>`).join('')}</tbody>
        </table>
        <p class="foot">หน้า ${pageNo} จาก ${total}</p>
      </section>`;
  }).join('');

  const html = '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">'
    + `<title>${esc(filename)}</title><style>${styles(fontBase64)}</style></head>`
    + `<body>${mainHtml}${summaryHtml}${SHRINK_SCRIPT}</body></html>`;

  return { html, pages: total };
};
