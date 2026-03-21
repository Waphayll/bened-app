export const TEMP_PASSWORD = 'BenedTemp2026!';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDisplayName(email) {
  const localPart = email.split('@')[0] || 'temporary.user';

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Temporary User';
}

export function authenticateTemporaryUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return {
      ok: false,
      message: 'Please enter a valid email address.',
    };
  }

  if (password !== TEMP_PASSWORD) {
    return {
      ok: false,
      message: 'Incorrect password. Use the temporary password for this build.',
    };
  }

  return {
    ok: true,
    user: {
      id: `temp-${normalizedEmail.replace(/[^a-z0-9]+/g, '-')}`,
      username: toDisplayName(normalizedEmail),
      email: normalizedEmail,
      user_id: 'TEMP-LOCAL-USER',
    },
  };
}
