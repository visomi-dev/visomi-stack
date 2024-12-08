import { z } from 'zod';

export const insertUserSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  email: z.string().email(),
  nickname: z.string().min(3).max(30),
  locale: z.string().optional(),
});

export const signUpSchema = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  nickname: z.string(),
  locale: z.enum(['es_419', 'en_US', 'pt_BR']).optional(),
});

export const signUpConfirmSchema = z.object({
  username: z.string(),
  code: z.string(),
});

export const forgottenPasswordSchema = z.object({
  username: z.string(),
});

export const passwordRecoverySchema = z.object({
  username: z.string(),
  code: z.string().length(6),
  password: z.string(),
});

export const signInSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const refreshSessionSchema = z.object({
  refreshToken: z
    .string()
    .regex(/^[A-Za-z0-9-_]+.[A-Za-z0-9-_]+.[A-Za-z0-9-_]+$/, 'Invalid token'),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type SignUp = z.infer<typeof signUpSchema>;
export type SignUpConfirm = z.infer<typeof signUpConfirmSchema>;
export type ForgottenPassword = z.infer<typeof forgottenPasswordSchema>;
export type PasswordRecovery = z.infer<typeof passwordRecoverySchema>;
export type SignIn = z.infer<typeof signInSchema>;

export type JobData = {
  id: string;
};
