// เรนเดอร์หน้าเว็บเป็น PDF ด้วยเบราว์เซอร์ที่ติดตั้งอยู่บนเครื่องแล้ว
//
// ตั้งใจไม่ใช้ puppeteer เพราะจะลาก Chromium มาอีกชุดเกือบ 300 MB
// เครื่องที่รันแอปเป็น Windows ซึ่งมี Edge ติดมากับระบบอยู่แล้วเสมอ
// (บทเรียนเดียวกับตอนถอน sharp ออก — ไม่เพิ่มของหนักให้เครื่องที่รับช่วงดูแลต่อ)
//
// ถ้าเครื่องไหนหาไม่เจอ ตั้ง PDF_BROWSER ใน server/.env ชี้ไปที่ไฟล์เบราว์เซอร์ได้
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

let cachedBrowser;

export class RenderError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 500;
  }
}

export const findBrowser = () => {
  if (cachedBrowser) return cachedBrowser;

  const configured = process.env.PDF_BROWSER;
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new RenderError(`PDF_BROWSER ชี้ไปที่ ${configured} แต่ไม่พบไฟล์นั้น`);
    }
    cachedBrowser = configured;
    return cachedBrowser;
  }

  const found = CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new RenderError(
      'สร้าง PDF ไม่ได้เพราะหาเบราว์เซอร์บนเครื่องไม่เจอ — '
      + 'ติดตั้ง Google Chrome หรือ Microsoft Edge แล้วลองใหม่ '
      + 'หรือตั้ง PDF_BROWSER ใน server/.env ให้ชี้ไปที่ไฟล์เบราว์เซอร์โดยตรง'
    );
  }
  cachedBrowser = found;
  return cachedBrowser;
};

// เปิดเบราว์เซอร์ทีละงาน — รายงานช่วงยาวกินแรงเครื่องพอควร
// ถ้าปล่อยให้เปิดพร้อมกันหลายตัวเครื่องจะอืดจนกระทบคนใช้งานหน้าเว็บ
let queue = Promise.resolve();

const runBrowser = (browser, url, outPath) => new Promise((resolve, reject) => {
  // โปรไฟล์แยกทุกครั้ง กันชนกับเบราว์เซอร์ที่ผู้ใช้เปิดอยู่บนเครื่องเดียวกัน
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-pdf-'));
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-pdf-header-footer',
    // รอให้สคริปต์ย่อรูปในหน้าทำงานจบก่อนพิมพ์ — ไม่งั้นได้รูปเต็มความละเอียดไฟล์บวม
    '--virtual-time-budget=20000',
    `--user-data-dir=${profile}`,
    `--print-to-pdf=${outPath}`,
    url
  ], { windowsHide: true });

  let stderr = '';
  child.stderr.on('data', (buf) => { stderr += buf.toString(); });

  const timer = setTimeout(() => {
    child.kill('force');
    reject(new RenderError('สร้าง PDF ไม่สำเร็จ — เบราว์เซอร์ใช้เวลานานเกินไป (เกิน 60 วินาที)'));
  }, 60000);

  child.on('error', (err) => {
    clearTimeout(timer);
    reject(new RenderError(`เรียกเบราว์เซอร์ไม่สำเร็จ: ${err.message}`));
  });

  child.on('close', () => {
    clearTimeout(timer);
    fs.rmSync(profile, { recursive: true, force: true });
    // เช็คจากไฟล์ปลายทางแทน exit code — headless คืน code ไม่นิ่งข้ามเวอร์ชัน
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return resolve(outPath);
    reject(new RenderError(`สร้าง PDF ไม่สำเร็จ${stderr ? ` (${stderr.trim().split('\n').pop()})` : ''}`));
  });
});

/**
 * เรนเดอร์หน้าเว็บที่ url เป็นไฟล์ PDF ที่ outPath
 * งานถูกต่อคิวให้ทำทีละอัน
 */
export const renderUrlToPdf = (url, outPath) => {
  const job = queue.then(() => runBrowser(findBrowser(), url, outPath));
  // คิวต้องเดินต่อแม้งานก่อนหน้าพัง ไม่งั้นงานถัดไปค้างตลอดกาล
  queue = job.catch(() => {});
  return job;
};
