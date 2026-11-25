import { describe, it, expect, vi } from 'vitest'
import { fromRow, toPublicDTO } from '../src/models/user.model.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import { UserRepository } from '../src/modules/users/user.repository.js'
import { createFakeSupabase } from './helpers/fakeSupabase.js'

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('user.model (tabla public."user" de Noto)', () => {
  it('combina la fila con el correo y los segundos nombres de Supabase Auth', () => {
    const row = { user_id: 'u1', name: 'Ana', last_name: 'López', nickname: 'Anita', credits: 2.5, image_url: 'http://x/a.png' }
    const authUser = {
      email: 'ana@noto.com',
      created_at: '2026-01-01T00:00:00Z',
      user_metadata: { middle_name: 'María', second_last_name: 'Ruiz' },
    }

    expect(toPublicDTO(fromRow(row, authUser))).toEqual({
      id: 'u1',
      firstName: 'Ana',
      middleName: 'María',
      lastName: 'López',
      secondLastName: 'Ruiz',
      fullName: 'Ana María López Ruiz',
      email: 'ana@noto.com',
      nickname: 'Anita',
      avatarUrl: 'http://x/a.png',
      credits: 2.5,
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('sin usuario de Auth deja el correo y los segundos nombres en null', () => {
    const user = fromRow({ user_id: 'u1', name: 'Ana', last_name: 'López', nickname: 'Ana', credits: 0 })
    expect(user).toMatchObject({ email: null, middleName: null, secondLastName: null, fullName: 'Ana López' })
  })
})

describe('AuthService con la tabla public."user" de Noto', () => {
  function buildService(fakeSupabase) {
    return new AuthService({
      userRepository: new UserRepository({ supabaseAdmin: fakeSupabase }),
      createAnonClient: () => fakeSupabase,
      adminClient: fakeSupabase,
      env: {},
      logger: silentLogger,
    })
  }

  it('el registro guarda name, last_name y nickname (por defecto, el nombre)', async () => {
    const fake = createFakeSupabase()
    const service = buildService(fake)

    const { user } = await service.register({
      firstName: 'Luis', middleName: 'Ángel', lastName: 'Díaz', secondLastName: null,
      email: 'Luis@Noto.com', password: 'Password123!',
    })

    const row = fake._internal.usersDb.get(user.id)
    expect(row).toMatchObject({ name: 'Luis', last_name: 'Díaz', nickname: 'Luis' })
    expect(row).not.toHaveProperty('email')
    // El trigger de alta del proyecto exige name, last_name y nickname en user_metadata
    expect(fake._internal.usersAuth.get(user.id).user_metadata).toMatchObject({
      name: 'Luis', last_name: 'Díaz', nickname: 'Luis', middle_name: 'Ángel',
    })
    expect(user.credits).toBe(0)
    expect(user).toMatchObject({ email: 'luis@noto.com', middleName: 'Ángel', nickname: 'Luis' })
  })

  it('un correo ya registrado (usuario sin identidades) responde EMAIL_ALREADY_REGISTERED', async () => {
    const fake = createFakeSupabase()
    fake.auth.signUp = async () => ({ data: { user: { id: 'x', identities: [] }, session: null }, error: null })

    await expect(
      buildService(fake).register({ firstName: 'A', lastName: 'B', email: 'a@noto.com', password: 'Password123!' })
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' })
    expect(fake._internal.usersDb.size).toBe(0)
  })

  it('actualizar el perfil guarda el segundo nombre en user_metadata', async () => {
    const fake = createFakeSupabase()
    const service = buildService(fake)
    const { user } = await service.register({
      firstName: 'Eva', lastName: 'Sol', email: 'eva@noto.com', password: 'Password123!',
    })
    const authUser = fake._internal.usersAuth.get(user.id)

    const updated = await service.updateProfile({
      user: authUser, firstName: 'Eva', middleName: 'Luz', lastName: 'Sol', secondLastName: 'Mar', avatarUrl: null,
    })

    expect(updated).toMatchObject({ middleName: 'Luz', secondLastName: 'Mar', fullName: 'Eva Luz Sol Mar' })
    expect(fake._internal.usersAuth.get(user.id).user_metadata).toMatchObject({ middle_name: 'Luz', second_last_name: 'Mar' })
  })
})
