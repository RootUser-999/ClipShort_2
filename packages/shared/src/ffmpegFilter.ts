import type { FramingMode } from './types.ts';

export interface FfmpegFilterBuildOptions {
  framing: FramingMode;
  cropX?: number; // 0..1
  sourceFps?: number;
  hasAudio: boolean;
}

export interface BuiltFfmpegFilter {
  filterComplex: string;
  videoMapLabel: string;
  audioMapArgs: string[];
  targetFps: number;
}

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const MAX_OUTPUT_FPS = 30;

export function buildFfmpegFilterGraph(options: FfmpegFilterBuildOptions): BuiltFfmpegFilter {
  const { framing, hasAudio } = options;
  const clampedCropX =
    options.cropX !== undefined && Number.isFinite(options.cropX)
      ? Math.min(1, Math.max(0, options.cropX))
      : 0.5;

  const targetFps =
    options.sourceFps && Number.isFinite(options.sourceFps) && options.sourceFps > 0
      ? Math.min(MAX_OUTPUT_FPS, Math.max(1, Math.round(options.sourceFps * 100) / 100))
      : MAX_OUTPUT_FPS;

  const fpsFilter = `fps=${targetFps}`;
  let videoFilterChain: string;

  if (framing === 'center') {
    videoFilterChain = [
      `[0:v]${fpsFilter}`,
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${TARGET_WIDTH}:${TARGET_HEIGHT}`,
      `setsar=1`,
      `format=yuv420p[vout]`,
    ].join(',');
  } else if (framing === 'custom') {
    // cropX in [0, 1] determines horizontal slice inside the scaled cover frame.
    // max(0, iw-1080) guards against sources already narrower than 9:16.
    const xExpr = `floor(max(0\\,iw-${TARGET_WIDTH})*${clampedCropX.toFixed(4)})`;
    const yExpr = `floor(max(0\\,ih-${TARGET_HEIGHT})/2)`;
    videoFilterChain = [
      `[0:v]${fpsFilter}`,
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${TARGET_WIDTH}:${TARGET_HEIGHT}:${xExpr}:${yExpr}`,
      `setsar=1`,
      `format=yuv420p[vout]`,
    ].join(',');
  } else {
    // 'blur': split stream into blurred scaled background + centered fit foreground
    videoFilterChain = [
      `[0:v]${fpsFilter},split=2[bg][fg]`,
      `[bg]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},boxblur=luma_radius=30:luma_power=2:chroma_radius=15:chroma_power=2[bg_blur]`,
      `[fg]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease[fg_fit]`,
      `[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[vout]`,
    ].join(';');
  }

  return {
    filterComplex: videoFilterChain,
    videoMapLabel: '[vout]',
    audioMapArgs: hasAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an'],
    targetFps,
  };
}
