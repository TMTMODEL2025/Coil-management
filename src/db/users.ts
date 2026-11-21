import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { auditLogs, roles, users } from './schema.ts';
import { ensureMasterSeedData, getRoleByCode } from './seed.ts';

const BOOTSTRAP_ADMIN_EMAIL = 'tmtmodel2025@gmail.com';

export interface AuthenticatedDbUser {
  id: number;
  uid: string;
  email: string;
  displayName: string | null;
  roleId: number;
  roleCode: string;
  roleName: string;
  isActive: boolean;
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null
): Promise<AuthenticatedDbUser> {
  try {
    await ensureMasterSeedData();

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        roleId: users.roleId,
        isActive: users.isActive,
        roleCode: roles.code,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.uid, uid))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          email: normalizedEmail,
          displayName: displayName ?? existing[0].displayName,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id));
      return {
        ...existing[0],
        email: normalizedEmail,
        displayName: displayName ?? existing[0].displayName,
      };
    }

    // Determine initial role: project owner or very first user becomes ADMIN; others default to OPERATOR
    const anyExistingUser = await db.select({ id: users.id }).from(users).limit(1);
    const shouldBeAdmin =
      normalizedEmail === BOOTSTRAP_ADMIN_EMAIL || anyExistingUser.length === 0;
    const targetRole =
      (await getRoleByCode(shouldBeAdmin ? 'ADMIN' : 'OPERATOR')) ??
      (await getRoleByCode('OPERATOR'));

    if (!targetRole) {
      throw new Error('Default RBAC role records are missing.');
    }

    const [upserted] = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName: displayName ?? normalizedEmail.split('@')[0],
        roleId: targetRole.id,
        isActive: true,
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          displayName: displayName ?? normalizedEmail.split('@')[0],
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    const [joined] = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        roleId: users.roleId,
        isActive: users.isActive,
        roleCode: roles.code,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, upserted.id))
      .limit(1);

    return joined;
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Unable to synchronize authenticated user profile.', { cause: error });
  }
}

export async function writeAuditLog(params: {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      beforeJson: params.beforeJson ?? null,
      afterJson: params.afterJson ?? null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    throw new Error('Failed to persist audit trail record.', { cause: error });
  }
}
