import * as bcrypt from 'bcrypt';
import { Injectable } from '@nestjs/common';

@Injectable()
export class BcryptService {
  rounds = 10;

  async hash(plain: string): Promise<string> {
    const salt = await bcrypt.genSalt(this.rounds);

    return await bcrypt.hash(plain, salt);
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(plain, hash);
  }
}
