import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Person detection for app-side tracking (phase 7): Google MediaPipe Pose,
// Apache 2.0. Its code and models are copied next to the window's files, so
// tracking works with no internet. The 27 MB "heavy" model is left out.
const POSE_FILES = [
    'pose.js',
    'pose_web.binarypb',
    'pose_solution_packed_assets_loader.js',
    'pose_solution_packed_assets.data',
    'pose_solution_simd_wasm_bin.js',
    'pose_solution_simd_wasm_bin.wasm',
    'pose_solution_simd_wasm_bin.data',
    'pose_solution_wasm_bin.js',
    'pose_solution_wasm_bin.wasm',
    'pose_landmark_lite.tflite',
    'pose_landmark_full.tflite',
];

function copyPose() {
    return {
        name: 'copy-mediapipe-pose',
        closeBundle() {
            const from = path.resolve('node_modules/@mediapipe/pose');
            const to = path.resolve('dist-renderer/mediapipe');
            fs.mkdirSync(to, { recursive: true });
            for (const f of POSE_FILES) fs.copyFileSync(path.join(from, f), path.join(to, f));
        },
    };
}

// The window's code lives in frontend/ and is built into dist-renderer/,
// which main.js loads from disk.
export default defineConfig({
    root: 'frontend',
    base: './',
    plugins: [react(), tailwindcss(), copyPose()],
    build: {
        outDir: '../dist-renderer',
        emptyOutDir: true,
    },
});
