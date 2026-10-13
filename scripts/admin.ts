// Admin CLI. Usage:
//   npm run admin -- reset-password <email>
//   npm run admin -- list-users
import { existsSync } from 'node:fs';
import { all, closeDb, getDb } from '../server/db';
import { hashPassword } from '../server/lib/crypto';
import { randomBase32 } from '../server/lib/ids';
import { deleteUserSessions } from '../server/services/sessions';
import { getUserAuthByEmail, updateUser } from '../server/services/users';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);
  getDb();

  if (command === 'reset-password') {
    if (!arg) {
      console.error('Usage: npm run admin -- reset-password <email>');
      return 1;
    }
    const found = getUserAuthByEmail(arg);
    if (!found) {
      console.error(`No user with email ${arg}`);
      return 1;
    }
    const password = `${randomBase32(4)}-${randomBase32(4)}-${randomBase32(4)}`;
    updateUser(found.user.id, { passwordHash: await hashPassword(password) });
    deleteUserSessions(found.user.id);
    console.log(`Temporary password for ${found.user.email}: ${password}`);
    console.log('All sessions were signed out. Ask the user to change it in Settings.');
    return 0;
  }

  if (command === 'list-users') {
    const rows = all<{ email: string; name: string; created_at: string }>('SELECT email, name, created_at FROM users ORDER BY created_at');
    for (const row of rows) console.log(`${row.created_at}  ${row.email}  ${row.name}`);
    console.log(`${rows.length} user(s)`);
    return 0;
  }

  console.error('Commands: reset-password <email> | list-users');
  return 1;
}

main()
  .then((code) => {
    closeDb();
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    closeDb();
    process.exit(1);
  });
