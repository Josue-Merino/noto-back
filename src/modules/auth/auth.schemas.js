import { z } from 'zod'

// Supabase Auth del proyecto exige minúscula, mayúscula, número y uno de estos símbolos
const PASSWORD_SYMBOL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|<>?,./`~]/

const optionalString = z
  .string()
  .trim()
  .max(60, 'No puede exceder 60 caracteres')
  .optional()
  .or(z.literal(''))
  .transform((val) => (val === '' ? undefined : val))

export const registerSchema = z
  .object({
    firstName: z
      .string({ required_error: 'El nombre es obligatorio' })
      .trim()
      .min(1, 'El nombre es obligatorio')
      .max(60, 'El nombre no puede exceder 60 caracteres'),
    middleName: optionalString,
    lastName: z
      .string({ required_error: 'El primer apellido es obligatorio' })
      .trim()
      .min(1, 'El primer apellido es obligatorio')
      .max(60, 'El primer apellido no puede exceder 60 caracteres'),
    secondLastName: optionalString,
    email: z
      .string({ required_error: 'El correo electrónico es obligatorio' })
      .trim()
      .toLowerCase()
      .min(1, 'El correo electrónico es obligatorio')
      .email('Ingresa un correo electrónico válido'),
    password: z
      .string({ required_error: 'La contraseña es obligatoria' })
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(72, 'La contraseña no puede exceder 72 caracteres')
      .regex(/[a-z]/, 'La contraseña debe contener al menos una minúscula')
      .regex(/[A-Z]/, 'La contraseña debe contener al menos una mayúscula')
      .regex(/[0-9]/, 'La contraseña debe contener al menos un número')
      .regex(PASSWORD_SYMBOL_RE, 'La contraseña debe contener al menos un símbolo (por ejemplo ! @ # $ %)'),
    confirmPassword: z
      .string({ required_error: 'Confirma tu contraseña' })
      .min(1, 'Confirma tu contraseña'),
  })
  .strict('No se permiten campos adicionales')
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

export const loginSchema = z
  .object({
    email: z
      .string({ required_error: 'El correo electrónico es obligatorio' })
      .trim()
      .toLowerCase()
      .min(1, 'El correo electrónico es obligatorio')
      .email('Ingresa un correo electrónico válido'),
    password: z
      .string({ required_error: 'La contraseña es obligatoria' })
      .min(1, 'La contraseña es obligatoria'),
  })
  .strict('No se permiten campos adicionales')

export const forgotPasswordSchema = z
  .object({
    email: z
      .string({ required_error: 'El correo electrónico es obligatorio' })
      .trim()
      .toLowerCase()
      .min(1, 'El correo electrónico es obligatorio')
      .email('Ingresa un correo electrónico válido'),
  })
  .strict('No se permiten campos adicionales')

export const resetPasswordSchema = z
  .object({
    password: z
      .string({ required_error: 'La nueva contraseña es obligatoria' })
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(72, 'La contraseña no puede exceder 72 caracteres')
      .regex(/[a-z]/, 'La contraseña debe contener al menos una minúscula')
      .regex(/[A-Z]/, 'La contraseña debe contener al menos una mayúscula')
      .regex(/[0-9]/, 'La contraseña debe contener al menos un número')
      .regex(PASSWORD_SYMBOL_RE, 'La contraseña debe contener al menos un símbolo (por ejemplo ! @ # $ %)'),
    confirmPassword: z
      .string({ required_error: 'Confirma tu contraseña' })
      .min(1, 'Confirma tu contraseña'),
  })
  .strict('No se permiten campos adicionales')
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: 'La contraseña actual es obligatoria' })
      .min(1, 'La contraseña actual es obligatoria'),
    newPassword: z
      .string({ required_error: 'La nueva contraseña es obligatoria' })
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(72, 'La contraseña no puede exceder 72 caracteres')
      .regex(/[a-z]/, 'La contraseña debe contener al menos una minúscula')
      .regex(/[A-Z]/, 'La contraseña debe contener al menos una mayúscula')
      .regex(/[0-9]/, 'La contraseña debe contener al menos un número')
      .regex(PASSWORD_SYMBOL_RE, 'La contraseña debe contener al menos un símbolo (por ejemplo ! @ # $ %)'),
    confirmPassword: z
      .string({ required_error: 'Confirma tu contraseña' })
      .min(1, 'Confirma tu contraseña'),
  })
  .strict('No se permiten campos adicionales')
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'La nueva contraseña debe ser distinta de la vigente',
    path: ['newPassword'],
  })

export const refreshTokenSchema = z
  .object({
    refreshToken: z
      .string({ required_error: 'El token de actualización es obligatorio' })
      .min(1, 'El token de actualización es obligatorio'),
  })
  .strict('No se permiten campos adicionales')

export const resendVerificationSchema = z
  .object({
    email: z
      .string({ required_error: 'El correo electrónico es obligatorio' })
      .trim()
      .toLowerCase()
      .min(1, 'El correo electrónico es obligatorio')
      .email('Ingresa un correo electrónico válido'),
  })
  .strict('No se permiten campos adicionales')

export const updateProfileSchema = z
  .object({
    firstName: z
      .string({ required_error: 'El nombre es obligatorio' })
      .trim()
      .min(1, 'El nombre es obligatorio')
      .max(60, 'El nombre no puede exceder 60 caracteres'),
    middleName: optionalString,
    lastName: z
      .string({ required_error: 'El primer apellido es obligatorio' })
      .trim()
      .min(1, 'El primer apellido es obligatorio')
      .max(60, 'El primer apellido no puede exceder 60 caracteres'),
    secondLastName: optionalString,
    avatarUrl: z.string().trim().nullable().optional().or(z.literal('')).transform((v) => (v === '' ? null : v)),
  })
  .strict('No se permiten campos adicionales')
