import { z } from "zod";

import { APP_USER_ROLES } from "@/features/settings/types";

const name = z.string().trim().min(1, "Informe o nome.");
// Validação tolerante ("algo@algo", sem espaços): aceita emails reais e também
// identificadores locais como "admin@local" (convenção do seed de dev). O banco
// normaliza com lower(trim()) e garante unicidade case-insensitive.
const email = z
  .string()
  .trim()
  .min(3, "Informe o email.")
  .regex(/^[^@\s]+@[^@\s]+$/, "Informe um email válido.");
const password = z.string().min(8, "A senha deve ter ao menos 8 caracteres.");
const role = z.enum(APP_USER_ROLES);
const avatarColor = z.string().trim().min(1).max(24);
// z.string().url() ACEITA javascript:, data: e file: — vetor de XSS armazenado
// quando a URL é renderizada. O avatar é sempre hospedado no bucket público do
// Supabase (http/https), então restringimos o esquema explicitamente.
const avatarUrl = z
  .string()
  .trim()
  .url("Informe uma URL válida.")
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "A URL do avatar deve começar com http(s)."
  );

// Pseudônimo usado para assinar as mensagens do chat. Vazio = usa o 1º nome.
const apelidoAtendimento = z.string().trim().max(40, "Máximo de 40 caracteres.");

export const createUserSchema = z.object({
  name,
  email,
  password,
  role,
  avatar_color: avatarColor.default("slate"),
  // Se marcado, o usuário é obrigado a definir a própria senha no 1º acesso.
  must_change_password: z.boolean().default(false),
  apelido_atendimento: apelidoAtendimento.optional(),
  assinar_mensagens: z.boolean().default(true),
});

// Nova senha que o próprio usuário define no primeiro acesso.
export const definirSenhaSchema = z.object({
  password,
});

export const updateUserSchema = z.object({
  name,
  email,
  is_active: z.boolean(),
  role,
  avatar_url: avatarUrl.nullable().optional(),
  avatar_color: avatarColor,
  // Opcionais: ausentes = "não altera" na RPC (o toggle de ativar/desativar não
  // os envia, e não pode apagar o apelido de ninguém).
  apelido_atendimento: apelidoAtendimento.optional(),
  assinar_mensagens: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  password,
  // Admin redefinindo a senha de OUTRO usuário pode forçar troca no próximo
  // login. Opcional: ausente = não altera a exigência atual.
  must_change_password: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
