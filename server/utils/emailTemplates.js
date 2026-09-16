// เทมเพลตอีเมลในนามบริษัท — ทุกฉบับใช้โครงเดียวกัน หน้าตาจึงเป็นมาตรฐานเดียวทั้งระบบ
//
// เขียนเป็นตาราง + inline style เพราะโปรแกรมอ่านอีเมล (Gmail / Outlook) ตัด <style> ทิ้ง
// และไม่รองรับ flex/grid — ถ้าเขียนแบบหน้าเว็บปกติ เปิดใน Outlook แล้วเลย์เอาต์จะพัง
//
// โลโก้แนบในอีเมลเป็น CID (cid:ics-logo) ไม่ได้ลิงก์ไปที่เว็บ — ขึ้นได้แม้ผู้รับเปิดอีเมล
// จากนอกเครือข่ายที่เข้าเว็บระบบไม่ถึง (sendEmail.js เป็นคนแนบไฟล์ให้)
//
// ข้อความที่มาจากผู้ใช้ (ชื่อผู้ใช้ อีเมล ลิงก์) ต้องผ่าน escapeHtml ทุกครั้ง
// เดิมใส่ชื่อผู้ใช้ลง HTML ตรงๆ คนสมัครจึงแทรกลิงก์หรือข้อความปลอมลงในอีเมลที่ออกในนามบริษัทได้

export const COMPANY = {
  name: 'iCreativeSystems Co., Ltd.',
  system: 'iCreativeSystems WMS',
  website: 'https://icsco.ai',
  websiteLabel: 'icsco.ai'
};
export const LOGO_CID = 'ics-logo';

const COLOR = {
  brand: '#0071BC',       // น้ำเงินเข้มจากตัวอักษรในโลโก้
  brandLight: '#62C6F2',  // ฟ้าจากวงโคจรในโลโก้
  text: '#1F2A37',
  muted: '#6B7280',
  border: '#E5E7EB',
  page: '#F1F5F9'
};
const TONE = {
  info: { bg: '#EAF5FC', bar: '#0071BC', text: '#0B4F7C' },
  success: { bg: '#ECFDF3', bar: '#16A34A', text: '#166534' },
  warning: { bg: '#FFF7E6', bar: '#D97706', text: '#92400E' },
  danger: { bg: '#FEF2F2', bar: '#DC2626', text: '#991B1B' }
};
const FONT = "'Sarabun','Leelawadee UI',Tahoma,Arial,sans-serif";

export const escapeHtml = (value) => String(value ?? '')
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// เวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่องที่รันระบบ
export const formatThaiDateTime = (date = new Date()) =>
  `${date.toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} น.`;

// ---- ชิ้นส่วนเนื้อหา: แต่ละ block มี type เดียว เรียงตามลำดับที่ส่งมา ----
const htmlBlock = (block) => {
  switch (block.type) {
    case 'p':
      return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.75;color:${COLOR.text};">${escapeHtml(block.text)}</p>`;
    case 'notice': {
      const tone = TONE[block.tone] || TONE.info;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;border-collapse:separate;">
  <tr><td style="background:${tone.bg};border-left:4px solid ${tone.bar};border-radius:6px;padding:14px 18px;font-family:${FONT};font-size:14px;line-height:1.7;color:${tone.text};">${escapeHtml(block.text)}</td></tr>
</table>`;
    }
    case 'details': {
      const rows = block.rows.map(([label, value], index) => {
        const line = index < block.rows.length - 1 ? `border-bottom:1px solid ${COLOR.border};` : '';
        return `<tr>
    <td width="36%" style="padding:11px 16px;${line}font-family:${FONT};font-size:14px;color:${COLOR.muted};vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:11px 16px;${line}font-family:${FONT};font-size:14px;color:${COLOR.text};font-weight:600;word-break:break-word;">${escapeHtml(value)}</td>
  </tr>`;
      }).join('\n  ');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;border:1px solid ${COLOR.border};border-radius:8px;border-collapse:separate;">
  ${rows}
</table>`;
    }
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center" bgcolor="${COLOR.brand}" style="border-radius:8px;background:${COLOR.brand};">
    <a href="${escapeHtml(block.url)}" target="_blank" style="display:inline-block;padding:13px 36px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>
  </td></tr>
</table>`;
    case 'small':
      return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.7;color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case 'link':
      return `<p style="margin:0 0 24px;font-family:${FONT};font-size:13px;line-height:1.6;word-break:break-all;"><a href="${escapeHtml(block.url)}" target="_blank" style="color:${COLOR.brand};">${escapeHtml(block.url)}</a></p>`;
    default:
      throw new Error(`unknown email block: ${block.type}`);
  }
};

const textBlock = (block) => {
  switch (block.type) {
    case 'details': return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'button': return `${block.label}: ${block.url}`;
    case 'link': return block.url;
    case 'notice': return `** ${block.text} **`;
    default: return block.text;
  }
};

const SIGN_OFF = ['ขอแสดงความนับถือ', `ทีมผู้ดูแลระบบ ${COMPANY.system}`];
const AUTO_NOTE = 'อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ';

const renderHtml = ({ preheader, heading, name, blocks, footnotes = [] }) => `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.page};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${COLOR.border};border-radius:12px;border-collapse:separate;overflow:hidden;">
    <tr><td height="6" style="height:6px;line-height:6px;font-size:0;background:${COLOR.brand};background-image:linear-gradient(90deg,${COLOR.brand},${COLOR.brandLight});">&nbsp;</td></tr>
    <tr><td style="padding:24px 36px 20px;border-bottom:1px solid ${COLOR.border};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle"><img src="cid:${LOGO_CID}" width="92" height="64" alt="iCreativeSystems" style="display:block;border:0;outline:none;width:92px;height:64px;"></td>
          <td align="right" valign="middle" style="font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOR.muted};">ระบบบริหารคลังสินค้า<br><span style="color:${COLOR.brand};font-weight:700;letter-spacing:1px;">WAREHOUSE MANAGEMENT SYSTEM</span></td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:32px 36px 8px;">
      <h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:1.45;font-weight:700;color:${COLOR.text};">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.75;color:${COLOR.text};">เรียน คุณ ${escapeHtml(name)}</p>
      ${blocks.map(htmlBlock).join('\n      ')}
    </td></tr>
    <tr><td style="padding:0 36px 28px;">
      <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.75;color:${COLOR.text};">${escapeHtml(SIGN_OFF[0])}<br><strong>${escapeHtml(SIGN_OFF[1])}</strong></p>
      ${footnotes.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid ${COLOR.border};padding-top:16px;">${footnotes.map((text) => `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.7;color:${COLOR.muted};">${escapeHtml(text)}</p>`).join('')}</td></tr></table>` : ''}
    </td></tr>
    <tr><td align="center" style="background:#F8FAFC;border-top:1px solid ${COLOR.border};padding:20px 36px;font-family:${FONT};font-size:12px;line-height:1.7;color:${COLOR.muted};">
      <strong style="color:${COLOR.text};">${escapeHtml(COMPANY.name)}</strong><br>
      <a href="${COMPANY.website}" target="_blank" style="color:${COLOR.brand};text-decoration:none;">${COMPANY.websiteLabel}</a><br>
      ${escapeHtml(AUTO_NOTE)}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

const renderText = ({ heading, name, blocks, footnotes = [] }) => [
  heading,
  '',
  `เรียน คุณ ${name}`,
  '',
  ...blocks.map(textBlock).flatMap((text) => [text, '']),
  ...SIGN_OFF,
  ...(footnotes.length ? ['', ...footnotes] : []),
  '',
  '—',
  COMPANY.name,
  COMPANY.website,
  AUTO_NOTE
].join('\n');

const build = (kind, subject, content) => ({
  kind,
  subject: `[${COMPANY.system}] ${subject}`,
  html: renderHtml(content),
  text: renderText(content)
});

// ---------------------------------------------------------------------------
// อีเมลแต่ละฉบับ
// ---------------------------------------------------------------------------

export const registrationReceivedEmail = ({ username, email, at = new Date() }) =>
  build('registration', 'ได้รับคำขอสมัครใช้งานแล้ว', {
    preheader: 'คำขอสมัครใช้งานของท่านอยู่ระหว่างรอผู้ดูแลระบบพิจารณา',
    heading: 'ได้รับคำขอสมัครใช้งานของท่านแล้ว',
    name: username,
    blocks: [
      { type: 'p', text: `ขอบคุณที่สมัครใช้งานระบบบริหารคลังสินค้า ${COMPANY.system} ระบบได้รับคำขอของท่านเรียบร้อยแล้ว และอยู่ระหว่างให้ผู้ดูแลระบบตรวจสอบ` },
      { type: 'details', rows: [['ชื่อผู้ใช้', username], ['อีเมล', email], ['สถานะ', 'รอการอนุมัติ'], ['วันที่สมัคร', formatThaiDateTime(at)]] },
      { type: 'notice', tone: 'info', text: 'ท่านจะยังเข้าสู่ระบบไม่ได้จนกว่าบัญชีจะได้รับการอนุมัติ เมื่อมีผลการพิจารณาแล้ว ระบบจะแจ้งให้ทราบทางอีเมลอีกครั้ง' }
    ],
    footnotes: ['หากท่านไม่ได้เป็นผู้สมัครใช้งาน กรุณาเพิกเฉยต่ออีเมลฉบับนี้']
  });

export const passwordResetEmail = ({ username, resetLink, expiresInMinutes }) =>
  build('password_reset', 'คำขอตั้งรหัสผ่านใหม่', {
    preheader: `ลิงก์ตั้งรหัสผ่านใหม่ ใช้ได้ภายใน ${expiresInMinutes} นาที`,
    heading: 'คำขอตั้งรหัสผ่านใหม่',
    name: username,
    blocks: [
      { type: 'p', text: 'ระบบได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของท่าน กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่' },
      { type: 'button', label: 'ตั้งรหัสผ่านใหม่', url: resetLink },
      { type: 'notice', tone: 'warning', text: `ลิงก์นี้ใช้ได้เพียงครั้งเดียว และจะหมดอายุภายใน ${expiresInMinutes} นาที` },
      { type: 'small', text: 'หากกดปุ่มไม่ได้ ให้คัดลอกลิงก์ด้านล่างไปเปิดในเบราว์เซอร์' },
      { type: 'link', url: resetLink }
    ],
    footnotes: [
      'หากท่านไม่ได้ส่งคำขอนี้ ไม่ต้องดำเนินการใดๆ รหัสผ่านเดิมของท่านยังใช้งานได้ตามปกติ',
      'เพื่อความปลอดภัยของบัญชี กรุณาอย่าส่งต่ออีเมลฉบับนี้ให้ผู้อื่น'
    ]
  });

const CONTACT_ADMIN = 'หากมีข้อสงสัย กรุณาติดต่อผู้ดูแลระบบของบริษัท';

/**
 * อีเมลแจ้งเปลี่ยนสถานะบัญชี — เลือกฉบับจาก "สถานะเดิม → สถานะใหม่"
 * เพราะปุ่มเดียวกันในหน้าจัดการผู้ใช้ให้ความหมายต่างกัน:
 *   รออนุมัติ → ใช้งาน = อนุมัติ     รออนุมัติ → ระงับ = ปฏิเสธคำขอ
 *   ถูกระงับ  → ใช้งาน = คืนสิทธิ์   ใช้งาน   → ระงับ = ระงับบัญชี
 * คืน null เมื่อไม่ต้องส่ง (สถานะไม่เปลี่ยน หรือย้อนกลับไปรออนุมัติ)
 */
export const accountStatusEmail = ({ previousStatus, status, username, roleLabel, loginUrl, at = new Date() }) => {
  const when = formatThaiDateTime(at);

  if (status === 'Active' && previousStatus === 'Pending') {
    return build('approved', 'บัญชีของท่านได้รับการอนุมัติแล้ว', {
      preheader: 'ท่านสามารถเข้าสู่ระบบได้ทันที',
      heading: 'บัญชีของท่านได้รับการอนุมัติแล้ว',
      name: username,
      blocks: [
        { type: 'p', text: `ขอแจ้งให้ทราบว่า คำขอสมัครใช้งานระบบ ${COMPANY.system} ของท่านได้รับการอนุมัติเรียบร้อยแล้ว` },
        { type: 'notice', tone: 'success', text: 'ท่านสามารถเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านที่ตั้งไว้ตอนสมัครได้ทันที' },
        { type: 'details', rows: [['ชื่อผู้ใช้', username], ['สิทธิ์การใช้งาน', roleLabel], ['วันที่อนุมัติ', when]] },
        { type: 'button', label: 'เข้าสู่ระบบ', url: loginUrl },
        { type: 'small', text: 'หากต้องการสิทธิ์การใช้งานเพิ่มเติมตามหน้าที่ กรุณาติดต่อผู้ดูแลระบบ' }
      ]
    });
  }

  if (status === 'Active' && previousStatus === 'Denied') {
    return build('restored', 'บัญชีของท่านได้รับการคืนสิทธิ์การใช้งานแล้ว', {
      preheader: 'ท่านกลับมาเข้าสู่ระบบได้ตามปกติแล้ว',
      heading: 'บัญชีของท่านได้รับการคืนสิทธิ์การใช้งานแล้ว',
      name: username,
      blocks: [
        { type: 'p', text: `ขอแจ้งให้ทราบว่า บัญชีของท่านในระบบ ${COMPANY.system} ได้รับการคืนสิทธิ์การใช้งานเรียบร้อยแล้ว` },
        { type: 'notice', tone: 'success', text: 'ท่านสามารถเข้าสู่ระบบได้ตามปกติตั้งแต่บัดนี้' },
        { type: 'details', rows: [['ชื่อผู้ใช้', username], ['สิทธิ์การใช้งาน', roleLabel], ['วันที่คืนสิทธิ์', when]] },
        { type: 'button', label: 'เข้าสู่ระบบ', url: loginUrl }
      ]
    });
  }

  if (status === 'Denied' && previousStatus === 'Pending') {
    return build('rejected', 'ผลการพิจารณาคำขอสมัครใช้งาน', {
      preheader: 'แจ้งผลการพิจารณาคำขอสมัครใช้งานของท่าน',
      heading: 'ผลการพิจารณาคำขอสมัครใช้งาน',
      name: username,
      blocks: [
        { type: 'p', text: `ขอเรียนแจ้งว่า คำขอสมัครใช้งานระบบ ${COMPANY.system} ของท่านไม่ได้รับการอนุมัติ` },
        { type: 'details', rows: [['ชื่อผู้ใช้', username], ['ผลการพิจารณา', 'ไม่อนุมัติ'], ['วันที่พิจารณา', when]] },
        { type: 'notice', tone: 'info', text: 'หากท่านเห็นว่าเป็นความผิดพลาด หรือต้องการสอบถามเหตุผล กรุณาติดต่อผู้ดูแลระบบของบริษัท' }
      ]
    });
  }

  if (status === 'Denied' && previousStatus === 'Active') {
    return build('suspended', 'บัญชีของท่านถูกระงับการใช้งาน', {
      preheader: 'บัญชีของท่านถูกระงับการใช้งานชั่วคราว',
      heading: 'บัญชีของท่านถูกระงับการใช้งาน',
      name: username,
      blocks: [
        { type: 'p', text: `ขอแจ้งให้ทราบว่า บัญชีของท่านในระบบ ${COMPANY.system} ถูกระงับการใช้งานโดยผู้ดูแลระบบ` },
        { type: 'notice', tone: 'danger', text: 'ท่านจะไม่สามารถเข้าสู่ระบบได้ จนกว่าผู้ดูแลระบบจะคืนสิทธิ์การใช้งาน' },
        { type: 'details', rows: [['ชื่อผู้ใช้', username], ['สถานะ', 'ถูกระงับการใช้งาน'], ['วันที่ระงับ', when]] },
        { type: 'small', text: CONTACT_ADMIN }
      ]
    });
  }

  return null;
};
