import * as bcrypt from 'bcrypt';

import { client } from '../client';

async function auth() {
  await Promise.all([
    client.user.deleteMany(),
    client.userPreference.deleteMany(),
    client.oneTimeCode.deleteMany(),
  ]);

  const password = await bcrypt.hash('Temporal1!', 10);

  await client.user.create({
    data: {
      username: 'visomi.dev@gmail.com',
      email: 'visomi.dev@gmail.com',
      password,
      nickname: 'Mikhael',
      preferences: {
        create: {
          locale: 'en_US',
        },
      },
    },
  });

  console.log('Seed data created');
}

export default auth;
