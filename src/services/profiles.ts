import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import { encrypt } from '../lib/crypto.js';
import { sanitizeUserText } from '../lib/text.js';

export async function updateProfile(db: PrismaClient, env: Env, input: { memberId: string; bio?: string; skills?: string; resumeUrl?: string; publicProfile?: boolean }) {
  return db.memberProfile.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      encryptedBio: input.bio ? encrypt(sanitizeUserText(input.bio, 2_000), env.DATA_ENCRYPTION_KEY) : undefined,
      encryptedSkills: input.skills ? encrypt(sanitizeUserText(input.skills, 1_000), env.DATA_ENCRYPTION_KEY) : undefined,
      encryptedResume: input.resumeUrl ? encrypt(sanitizeUserText(input.resumeUrl, 2_000), env.DATA_ENCRYPTION_KEY) : undefined,
      publicProfile: input.publicProfile ?? false
    },
    update: {
      encryptedBio: input.bio ? encrypt(sanitizeUserText(input.bio, 2_000), env.DATA_ENCRYPTION_KEY) : undefined,
      encryptedSkills: input.skills ? encrypt(sanitizeUserText(input.skills, 1_000), env.DATA_ENCRYPTION_KEY) : undefined,
      encryptedResume: input.resumeUrl ? encrypt(sanitizeUserText(input.resumeUrl, 2_000), env.DATA_ENCRYPTION_KEY) : undefined,
      publicProfile: input.publicProfile
    }
  });
}
