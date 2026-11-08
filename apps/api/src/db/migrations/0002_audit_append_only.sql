-- Le journal d'audit est append-only : aucune modification ni suppression possible,
-- même en cas de bug applicatif (docs/data-model.md, docs/security.md §8).
CREATE FUNCTION audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event est en ajout seul (% interdit)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();
