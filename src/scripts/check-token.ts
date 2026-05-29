/**
 * Meta access token holatini tekshirish.
 *
 * Foydalanish:
 *   npm run token:check
 */
import { tokenService } from '../meta/token.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

(async () => {
  try {
    const health = await tokenService.checkTokenHealth();
    logger.info({ health }, 'Token health');
    console.log('\n' + health.message + '\n');
    if (health.expiresAt) {
      console.log(`Expires at: ${health.expiresAt.toISOString()}`);
    }
  } catch (err) {
    logger.error({ err }, 'Token check xatosi');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  }
})();
