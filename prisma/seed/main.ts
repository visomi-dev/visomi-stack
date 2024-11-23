import auth from './auth';
import { client } from './client';

async function main(): Promise<void> {
  await auth();
}

main()
  .finally(() => {
    client.$disconnect();

    console.log('Seeding completed');
  })
  .catch(console.error);
