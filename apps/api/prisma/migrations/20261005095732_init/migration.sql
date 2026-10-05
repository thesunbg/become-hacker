-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "userId" TEXT NOT NULL,
    "avatar" TEXT,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "ethics" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "image" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_missions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "revealedHintLevels" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "bestRating" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_skills" (
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("userId","skill")
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "missionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "labId" TEXT,
    "image" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "lab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "missions_chapter_idx" ON "missions"("chapter");

-- CreateIndex
CREATE INDEX "user_missions_userId_state_idx" ON "user_missions"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "user_missions_userId_missionId_key" ON "user_missions"("userId", "missionId");

-- CreateIndex
CREATE INDEX "xp_transactions_userId_createdAt_idx" ON "xp_transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "lab_sessions_userId_status_idx" ON "lab_sessions"("userId", "status");

-- CreateIndex
CREATE INDEX "lab_events_userId_missionId_createdAt_idx" ON "lab_events"("userId", "missionId", "createdAt");

-- CreateIndex
CREATE INDEX "lab_events_sessionId_createdAt_idx" ON "lab_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_missions" ADD CONSTRAINT "user_missions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_missions" ADD CONSTRAINT "user_missions_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_sessions" ADD CONSTRAINT "lab_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_sessions" ADD CONSTRAINT "lab_sessions_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_events" ADD CONSTRAINT "lab_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "lab_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_events" ADD CONSTRAINT "lab_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
