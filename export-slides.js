const puppeteer = require("puppeteer");
const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

const HTML_FILE = path.resolve(__dirname, "index.html");
const OUTPUT_DIR = path.resolve(__dirname, "export");
const PPTX_FILE = path.join(OUTPUT_DIR, "ordr-pitch.pptx");
const SLIDE_COUNT = 12;

(async () => {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await page.goto(`file://${HTML_FILE}`, { waitUntil: "networkidle0" });

  // Wait for fonts and animations
  await new Promise((r) => setTimeout(r, 2000));

  // Make all slides visible (trigger reveal animations)
  await page.evaluate(() => {
    document.querySelectorAll(".slide").forEach((s) => s.classList.add("visible"));
  });
  await new Promise((r) => setTimeout(r, 1000));

  console.log("Capturing slides as images...");
  const imgPaths = [];

  for (let i = 0; i < SLIDE_COUNT; i++) {
    // Scroll to slide
    await page.evaluate((idx) => {
      document.getElementById(`slide-${idx}`).scrollIntoView({ behavior: "instant" });
    }, i);
    await new Promise((r) => setTimeout(r, 500));

    const imgPath = path.join(OUTPUT_DIR, `slide-${String(i + 1).padStart(2, "0")}.png`);

    // Screenshot just the viewport (one slide)
    await page.screenshot({ path: imgPath, type: "png" });
    imgPaths.push(imgPath);
    console.log(`  Captured slide ${i + 1}/${SLIDE_COUNT}`);
  }

  await browser.close();

  // Build PPTX
  console.log("Building PPTX...");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "HD", width: 13.33, height: 7.5 }); // 16:9
  pptx.layout = "HD";

  for (const imgPath of imgPaths) {
    const slide = pptx.addSlide();
    slide.background = { color: "0A0A0A" };
    slide.addImage({
      path: imgPath,
      x: 0,
      y: 0,
      w: 13.33,
      h: 7.5,
    });
  }

  await pptx.writeFile({ fileName: PPTX_FILE });
  console.log(`\nDone!`);
  console.log(`  Images: ${OUTPUT_DIR}/slide-01.png ... slide-10.png`);
  console.log(`  PPTX:   ${PPTX_FILE}`);
})();
