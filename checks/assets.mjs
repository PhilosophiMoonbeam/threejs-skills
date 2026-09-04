// Third-party ktx-parse ships with the pinned Three.js package; it only serializes this test fixture.
import { createDefaultContainer, write, KHR_DF_MODEL_RGBSDA, VK_FORMAT_R8G8B8A8_SRGB } from 'three/addons/libs/ktx-parse.module.js';

const hdr = Buffer.alloc(64 * 32 * 4);
for (let i = 0; i < hdr.length; i += 4) hdr.set([128, 128, 128, 129], i);
const ktx = createDefaultContainer();
Object.assign(ktx, { pixelWidth: 1, pixelHeight: 1, levelCount: 1, vkFormat: VK_FORMAT_R8G8B8A8_SRGB,
  levels: [{ levelData: new Uint8Array([255, 255, 255, 255]), uncompressedByteLength: 4 }] });
const dfd = ktx.dataFormatDescriptor[0];
dfd.colorModel = KHR_DF_MODEL_RGBSDA;
dfd.bytesPlane[0] = 4;
dfd.samples = Array.from({ length: 4 }, (_, channel) => ({
  bitOffset: channel * 8, bitLength: 7, channelType: channel === 3 ? 15 : channel,
  samplePosition: [0, 0, 0, 0], sampleLower: 0, sampleUpper: 255,
}));

export const assets = new Map([
  ['/assets/studio.hdr', Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 64\n'), hdr])],
  // Raw RGBA KTX2 exercises standalone loading and metadata, not Basis transcoding.
  ['/assets/material.ktx2', Buffer.from(write(ktx))],
]);
