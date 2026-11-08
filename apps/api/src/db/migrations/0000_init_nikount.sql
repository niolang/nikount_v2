CREATE TYPE "public"."nikount_state" AS ENUM('OPEN', 'SETTLEMENT', 'CLOSED');--> statement-breakpoint
CREATE TABLE "nikount" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"state" "nikount_state" DEFAULT 'OPEN' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"participant_token_hash" "bytea" NOT NULL,
	"participant_token_rotated_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nikount_participant_token_hash_unique" UNIQUE("participant_token_hash"),
	CONSTRAINT "nikount_name_length" CHECK (char_length("nikount"."name") between 1 and 60),
	CONSTRAINT "nikount_currency_format" CHECK ("nikount"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "nikount_token_hash_length" CHECK (octet_length("nikount"."participant_token_hash") = 32),
	CONSTRAINT "nikount_version_positive" CHECK ("nikount"."version" >= 1)
);
