# MySQL files

- `schema.sql`: only database and table structure.
- `legacy-data.sql`: old Laravel data inserts; run from this directory after schema.
- `zarin_hesab_full.sql`: complete schema plus existing data, ready for phpMyAdmin import.

The application can also create the same database automatically with:

```bash
npm run db:setup
```
