CREATE TYPE "public"."actor_kind" AS ENUM('ADMIN', 'PARTICIPANT', 'SYSTEM');--> statement-breakpoint
CREATE TABLE "admin_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nikount_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_by_admin_id" uuid,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_access_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "admin_access_label_length" CHECK (char_length("admin_access"."label") between 1 and 40),
	CONSTRAINT "admin_access_token_hash_length" CHECK (octet_length("admin_access"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"nikount_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_admin_id" uuid,
	"actor_participant_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	CONSTRAINT "audit_event_actor_consistency" CHECK (("audit_event"."actor_kind" = 'ADMIN') = ("audit_event"."actor_admin_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "nikount" ADD COLUMN "participant_token_ciphertext" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_access" ADD CONSTRAINT "admin_access_nikount_id_nikount_id_fk" FOREIGN KEY ("nikount_id") REFERENCES "public"."nikount"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_nikount_id_nikount_id_fk" FOREIGN KEY ("nikount_id") REFERENCES "public"."nikount"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_admin_id_admin_access_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_access"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_access_nikount_idx" ON "admin_access" USING btree ("nikount_id");--> statement-breakpoint
CREATE INDEX "audit_event_nikount_occurred_idx" ON "audit_event" USING btree ("nikount_id","occurred_at" DESC NULLS LAST);