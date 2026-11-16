import { z } from 'zod';
import { YOUTUBE_VIDEO_ID_REGEX } from './youtubeUrl.ts';

export const VideoInfoRequestSchema = z.object({
  url: z.string().trim().min(1, 'Please enter a YouTube URL.').max(2048, 'URL is too long.'),
});

export const CreateClipRequestSchema = z
  .object({
    videoId: z
      .string()
      .trim()
      .regex(YOUTUBE_VIDEO_ID_REGEX, 'Invalid YouTube video ID.'),
    start: z.number().finite().min(0, 'Start time must be >= 0.'),
    end: z.number().finite().positive('End time must be > 0.'),
    framing: z.enum(['center', 'custom', 'blur']),
    cropX: z.number().finite().min(0).max(1).optional(),
    rightsConfirmed: z.literal(true, {
      error: 'You must confirm you own or have permission to use this video.',
    }),
    turnstileToken: z.string().max(4096).optional(),
  })
  .refine((data) => data.end > data.start, {
    message: 'End time must be greater than start time.',
    path: ['end'],
  })
  .refine((data) => data.end - data.start >= 1, {
    message: 'Clip duration must be at least 1 second.',
    path: ['end'],
  })
  .refine((data) => data.end - data.start <= 60, {
    message: 'Clip duration cannot exceed 60 seconds.',
    path: ['end'],
  });

export const JobIdParamSchema = z.string().uuid('Invalid job ID.');
