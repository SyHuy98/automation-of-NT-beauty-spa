// Sinh icon PNG cho PWA từ public/icons/icon.svg (chạy: node scripts/generate-icons.mjs)
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg");
const out = "public/icons";
await sharp(svg).resize(192, 192).png().toFile(`${out}/icon-192.png`);
await sharp(svg).resize(512, 512).png().toFile(`${out}/icon-512.png`);
await sharp(svg).resize(180, 180).flatten({ background: "#3E2A1F" }).png().toFile(`${out}/apple-touch-icon.png`);
// Maskable: thu nhỏ vào vùng an toàn 80% trên nền espresso
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#3E2A1F" } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(`${out}/icon-maskable-512.png`);
await sharp(svg).resize(96, 96).png().toFile(`${out}/badge-96.png`);
console.log("Đã sinh icon");
