CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"minor_unit" smallint DEFAULT 2 NOT NULL
);
