CREATE TYPE "public"."distribution_mode" AS ENUM('EQUAL', 'SHARES', 'PERCENT', 'AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."transaction_category" AS ENUM('FOOD', 'TRANSPORT', 'GROCERIES', 'LODGING', 'ACTIVITY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('EXPENSE', 'REIMBURSEMENT');--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nikount_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"category" "transaction_category",
	"occurred_on" date NOT NULL,
	"payer_id" uuid NOT NULL,
	"distribution_mode" "distribution_mode" NOT NULL,
	"created_by_kind" "actor_kind" NOT NULL,
	"created_by_admin_id" uuid,
	"declared_by_participant_id" uuid,
	"client_request_id" uuid NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by_admin_id" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by_admin_id" uuid,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_admin_id" uuid,
	"cancellation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_nikount_id_id_unique" UNIQUE("nikount_id","id"),
	CONSTRAINT "transaction_client_request_unique" UNIQUE("nikount_id","client_request_id"),
	CONSTRAINT "transaction_amount_range" CHECK ("transaction"."amount" > 0 and "transaction"."amount" <= 100000000),
	CONSTRAINT "transaction_description_length" CHECK (char_length("transaction"."description") between 1 and 80),
	CONSTRAINT "transaction_version_positive" CHECK ("transaction"."version" >= 1),
	CONSTRAINT "transaction_reimbursement_equal" CHECK ("transaction"."type" <> 'REIMBURSEMENT' or "transaction"."distribution_mode" = 'EQUAL'),
	CONSTRAINT "transaction_creator_consistency" CHECK ("transaction"."created_by_kind" <> 'SYSTEM' and ("transaction"."created_by_kind" = 'ADMIN') = ("transaction"."created_by_admin_id" is not null)),
	CONSTRAINT "transaction_status_consistency" CHECK (case "transaction"."status"
        when 'PENDING' then "transaction"."validated_at" is null and "transaction"."rejected_at" is null and "transaction"."cancelled_at" is null
        when 'VALIDATED' then "transaction"."validated_at" is not null and "transaction"."validated_by_admin_id" is not null
          and "transaction"."rejected_at" is null and "transaction"."cancelled_at" is null
        when 'REJECTED' then "transaction"."rejected_at" is not null and "transaction"."rejected_by_admin_id" is not null
          and "transaction"."validated_at" is null and "transaction"."cancelled_at" is null
        when 'CANCELLED' then "transaction"."cancelled_at" is not null and "transaction"."cancelled_by_admin_id" is not null
          and "transaction"."rejected_at" is null
      end)
);
--> statement-breakpoint
CREATE TABLE "transaction_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"nikount_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by_kind" "actor_kind" NOT NULL,
	"changed_by_admin_id" uuid,
	"declared_by_participant_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_revision_number_unique" UNIQUE("transaction_id","revision"),
	CONSTRAINT "transaction_revision_number_positive" CHECK ("transaction_revision"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "transaction_share" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"nikount_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"input_value" numeric(12, 2) NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "transaction_share_participant_unique" UNIQUE("transaction_id","participant_id"),
	CONSTRAINT "transaction_share_amount_positive" CHECK ("transaction_share"."amount" >= 0),
	CONSTRAINT "transaction_share_input_positive" CHECK ("transaction_share"."input_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admin_access" ADD CONSTRAINT "admin_access_nikount_id_id_unique" UNIQUE("nikount_id","id");
--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_nikount_id_nikount_id_fk" FOREIGN KEY ("nikount_id") REFERENCES "public"."nikount"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_payer_same_nikount_fk" FOREIGN KEY ("nikount_id","payer_id") REFERENCES "public"."participant"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_declared_by_same_nikount_fk" FOREIGN KEY ("nikount_id","declared_by_participant_id") REFERENCES "public"."participant"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_created_by_same_nikount_fk" FOREIGN KEY ("nikount_id","created_by_admin_id") REFERENCES "public"."admin_access"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_validated_by_same_nikount_fk" FOREIGN KEY ("nikount_id","validated_by_admin_id") REFERENCES "public"."admin_access"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_rejected_by_same_nikount_fk" FOREIGN KEY ("nikount_id","rejected_by_admin_id") REFERENCES "public"."admin_access"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_cancelled_by_same_nikount_fk" FOREIGN KEY ("nikount_id","cancelled_by_admin_id") REFERENCES "public"."admin_access"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_revision" ADD CONSTRAINT "transaction_revision_transaction_same_nikount_fk" FOREIGN KEY ("nikount_id","transaction_id") REFERENCES "public"."transaction"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_revision" ADD CONSTRAINT "transaction_revision_admin_same_nikount_fk" FOREIGN KEY ("nikount_id","changed_by_admin_id") REFERENCES "public"."admin_access"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_share" ADD CONSTRAINT "transaction_share_transaction_same_nikount_fk" FOREIGN KEY ("nikount_id","transaction_id") REFERENCES "public"."transaction"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_share" ADD CONSTRAINT "transaction_share_participant_same_nikount_fk" FOREIGN KEY ("nikount_id","participant_id") REFERENCES "public"."participant"("nikount_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_nikount_status_idx" ON "transaction" USING btree ("nikount_id","status");--> statement-breakpoint
CREATE INDEX "transaction_nikount_occurred_idx" ON "transaction" USING btree ("nikount_id","occurred_on" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transaction_share_nikount_participant_idx" ON "transaction_share" USING btree ("nikount_id","participant_id");