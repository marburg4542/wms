import bcrypt from 'bcryptjs';
import { getUserByUsername, getUserByEmail, createUser, updateUser } from './data/userManager.js';
import { config } from './config.js';

async function createAdmin() {
  const { username, password } = config.bootstrapAdmin;
  const email = String(config.bootstrapAdmin.email || '').trim().toLowerCase();

  if (!password) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required to create an admin account.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const existing = getUserByUsername(username) || getUserByEmail(email);

  if (existing) {
    updateUser(existing.id, {
      username,
      email,
      password: hashedPassword,
      role: 'Admin',
      status: 'Active'
    });
  } else {
    createUser({
      username,
      email,
      password: hashedPassword,
      role: 'Admin',
      status: 'Active'
    });
  }

  console.log(`Admin account "${username}" is ready.`);
}

createAdmin().catch(error => {
  console.error(error.message);
  process.exit(1);
});
