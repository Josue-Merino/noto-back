/**
 * Doble de prueba (Mock) completo de Supabase para pruebas unitarias y de integración.
 */
export function createFakeSupabase() {
  const usersAuth = new Map()
  const usersDb = new Map()

  const getUser = async (token) => {
    if (!token || token === 'invalid-token') {
      return { data: { user: null }, error: { message: 'Invalid token' } }
    }
    for (const user of usersAuth.values()) {
      if (user.token === token) {
        return { data: { user }, error: null }
      }
    }
    return { data: { user: null }, error: { message: 'User not found for token' } }
  }

  const fakeAdmin = {
    getUser,
    deleteUser: async (userId) => {
      usersAuth.delete(userId)
      return { data: { user: null }, error: null }
    },
    updateUserById: async (userId, updates) => {
      const user = usersAuth.get(userId)
      if (!user) return { data: null, error: { message: 'User not found' } }
      Object.assign(user, updates)
      return { data: { user }, error: null }
    },
    signOut: async (_token) => {
      return { error: null }
    },
  }

  const fakeAuth = {
    admin: fakeAdmin,
    getUser,
    signUp: async ({ email, password, options }) => {
      const normalizedEmail = email.toLowerCase().trim()
      for (const u of usersAuth.values()) {
        if (u.email === normalizedEmail) {
          return {
            data: { user: null, session: null },
            error: { message: 'User already registered', code: 'user_already_exists' },
          }
        }
      }

      const id = `usr_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const user = {
        id,
        email: normalizedEmail,
        password,
        user_metadata: options?.data || {},
        email_confirmed_at: options?.data?.confirmed ? new Date().toISOString() : null,
        token: `mock-jwt-token-for-${id}`,
      }

      usersAuth.set(id, user)
      return { data: { user, session: null }, error: null }
    },

    signInWithPassword: async ({ email, password }) => {
      const normalizedEmail = email.toLowerCase().trim()
      let foundUser = null
      for (const u of usersAuth.values()) {
        if (u.email === normalizedEmail) {
          foundUser = u
          break
        }
      }

      if (!foundUser || foundUser.password !== password) {
        return {
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
        }
      }

      if (!foundUser.email_confirmed_at) {
        return {
          data: { user: null, session: null },
          error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
        }
      }

      const session = {
        access_token: foundUser.token,
        refresh_token: `mock-refresh-token-${foundUser.id}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }

      return { data: { user: foundUser, session }, error: null }
    },

    resend: async ({ email: _email }) => {
      return { data: { message: 'Sent' }, error: null }
    },

    refreshSession: async ({ refresh_token }) => {
      if (!refresh_token || refresh_token === 'invalid-refresh') {
        return { data: { session: null }, error: { message: 'Invalid refresh token' } }
      }
      return {
        data: {
          session: {
            access_token: 'new-mock-access-token',
            refresh_token: 'new-mock-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      }
    },

    resetPasswordForEmail: async (_email) => {
      return { data: {}, error: null }
    },
  }

  // Simulación de la tabla public."user"
  const from = (_table) => {
    return {
      insert: (row) => ({
        select: () => ({
          single: async () => {
            const copy = {
              ...row,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
            usersDb.set(row.user_id, copy)
            return { data: copy, error: null }
          },
        }),
      }),

      select: (_fields = '*') => ({
        eq: (col, val) => ({
          single: async () => {
            for (const row of usersDb.values()) {
              if (row[col] === val) return { data: row, error: null }
            }
            return { data: null, error: { message: 'No rows found', code: 'PGRST116' } }
          },
          maybeSingle: async () => {
            for (const row of usersDb.values()) {
              if (row[col] === val) return { data: row, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }),

      update: (updates) => ({
        eq: (col, val) => ({
          select: () => ({
            single: async () => {
              for (const [id, row] of usersDb.entries()) {
                if (row[col] === val) {
                  const updated = { ...row, ...updates, updated_at: new Date().toISOString() }
                  usersDb.set(id, updated)
                  return { data: updated, error: null }
                }
              }
              return { data: null, error: { message: 'Row not found to update' } }
            },
          }),
        }),
      }),

      delete: () => ({
        eq: (col, val) => {
          for (const [id, row] of usersDb.entries()) {
            if (row[col] === val) {
              usersDb.delete(id)
            }
          }
          return Promise.resolve({ error: null })
        },
      }),
    }
  }

  return {
    auth: fakeAuth,
    from,
    _internal: { usersAuth, usersDb },
  }
}
