CREATE TABLE "site_visit_days" (
	"site" varchar(40),
	"day" date,
	"page" varchar(40),
	"locale" varchar(2),
	"views" bigint NOT NULL,
	CONSTRAINT "site_visit_days_pkey" PRIMARY KEY("site","day","page","locale")
);
