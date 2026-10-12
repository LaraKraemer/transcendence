CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"minor_unit" smallint DEFAULT 2 NOT NULL
);
--> statement-breakpoint
INSERT INTO "currency" ("code", "name", "symbol", "minor_unit") VALUES
	('EUR', 'Euro', '€', 2),
	('USD', 'US Dollar', '$', 2),
	('GBP', 'British Pound', '£', 2),
	('JPY', 'Japanese Yen', '¥', 0),
	('CHF', 'Swiss Franc', 'Fr', 2),
	('CAD', 'Canadian Dollar', '$', 2),
	('AUD', 'Australian Dollar', '$', 2),
	('DKK', 'Danish Krone', 'kr', 2),
	('SEK', 'Swedish Krona', 'kr', 2),
	('NOK', 'Norwegian Krone', 'kr', 2),
	('PLN', 'Polish Zloty', 'zł', 2),
	('HUF', 'Hungarian Forint', 'Ft', 2),
	('CZK', 'Czech Koruna', 'Kč', 2),
	('RON', 'Romanian Leu', 'lei', 2),
	('TRY', 'Turkish Lira', '₺', 2),
	('BRL', 'Brazilian Real', 'R$', 2),
	('CNY', 'Chinese Yuan', '¥', 2),
	('KWD', 'Kuwaiti Dinar', 'KD', 3),
	('UAH', 'Ukrainian Hryvnia', '₴', 2);
