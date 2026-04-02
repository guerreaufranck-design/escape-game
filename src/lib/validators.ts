import { z } from "zod/v4";

export const activateSchema = z.object({
  code: z
    .string()
    .min(1, "Le code est requis")
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i, "Format de code invalide"),
  playerName: z.string().min(2, "Le nom doit contenir au moins 2 caracteres").max(50),
  teamName: z.string().max(50).optional(),
});

export const validateStepSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  stepOrder: z.number().int().positive(),
  answer: z.string().optional(),
});

export const hintSchema = z.object({
  stepOrder: z.number().int().positive(),
  hintIndex: z.number().int().min(0),
});

export const gameSchema = z.object({
  title: z.string().min(3, "Le titre doit contenir au moins 3 caracteres").max(100),
  description: z.string().max(1000).optional(),
  city: z.string().max(100).optional(),
  difficulty: z.number().int().min(1).max(5).default(3),
  estimatedDurationMin: z.number().int().positive().optional(),
  maxHintsPerStep: z.number().int().min(0).max(10).default(3),
  hintPenaltySeconds: z.number().int().min(0).default(120),
  coverImage: z.string().url().optional(),
});

export const stepSchema = z.object({
  title: z.string().min(1).max(100),
  riddleText: z.string().min(1).max(2000),
  answerText: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  validationRadiusMeters: z.number().int().min(5).max(500).default(30),
  hasPhotoChallenge: z.boolean().default(false),
  hints: z
    .array(
      z.object({
        order: z.number().int().positive(),
        text: z.string().min(1),
        image: z.string().optional(),
      })
    )
    .default([]),
  bonusTimeSeconds: z.number().int().min(0).default(0),
});

export const generateCodesSchema = z.object({
  gameId: z.string().uuid(),
  count: z.number().int().min(1).max(500),
  isSingleUse: z.boolean().default(true),
  maxUses: z.number().int().min(1).default(1),
  teamName: z.string().max(50).optional(),
  expiresAt: z.string().datetime().optional(),
});
