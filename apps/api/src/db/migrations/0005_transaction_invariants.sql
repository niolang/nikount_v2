-- Invariants des opérations financières, garantis par la base elle-même (docs/data-model.md).
-- Le moteur (@nikount/core) et les services les respectent déjà : ceci est le dernier filet.

-- 1. Une opération financière n'est JAMAIS supprimée : elle est annulée (CANCELLED).
CREATE FUNCTION transaction_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Une opération financière ne se supprime pas : elle s''annule (% interdit)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transaction_no_delete
  BEFORE DELETE ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION transaction_no_delete();
--> statement-breakpoint
CREATE TRIGGER transaction_no_truncate
  BEFORE TRUNCATE ON "transaction"
  FOR EACH STATEMENT EXECUTE FUNCTION transaction_no_delete();
--> statement-breakpoint

-- 2. Cohérence des parts, vérifiée en FIN de transaction SQL (contrainte différée) :
--    Σ parts = montant ; au moins un concerné ; remboursement = un seul concerné, différent du payeur.
CREATE FUNCTION transaction_check_shares(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  share_count integer;
  share_total bigint;
  payer_is_concerned boolean;
BEGIN
  SELECT id, type, amount, payer_id INTO t FROM "transaction" WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), coalesce(sum(amount), 0), coalesce(bool_or(participant_id = t.payer_id), false)
    INTO share_count, share_total, payer_is_concerned
    FROM transaction_share WHERE transaction_id = p_transaction_id;

  IF share_count = 0 THEN
    RAISE EXCEPTION 'Opération % sans concerné', p_transaction_id USING ERRCODE = 'check_violation';
  END IF;
  IF share_total <> t.amount THEN
    RAISE EXCEPTION 'Opération % : somme des parts (%) différente du montant (%)',
      p_transaction_id, share_total, t.amount USING ERRCODE = 'check_violation';
  END IF;
  IF t.type = 'REIMBURSEMENT' AND (share_count <> 1 OR payer_is_concerned) THEN
    RAISE EXCEPTION 'Remboursement % : un seul bénéficiaire, différent du payeur', p_transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION transaction_check_shares_from_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM transaction_check_shares(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION transaction_check_shares_from_share() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM transaction_check_shares(OLD.transaction_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM transaction_check_shares(NEW.transaction_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_shares_consistent
  AFTER INSERT OR UPDATE OF amount, type, payer_id ON "transaction"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_check_shares_from_transaction();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_share_consistent
  AFTER INSERT OR UPDATE OR DELETE ON transaction_share
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_check_shares_from_share();
--> statement-breakpoint

-- 3. Les révisions sont un historique : ni modifiées, ni supprimées.
CREATE FUNCTION transaction_revision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'transaction_revision est en ajout seul (% interdit)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transaction_revision_no_update_delete
  BEFORE UPDATE OR DELETE ON transaction_revision
  FOR EACH ROW EXECUTE FUNCTION transaction_revision_immutable();
--> statement-breakpoint
CREATE TRIGGER transaction_revision_no_truncate
  BEFORE TRUNCATE ON transaction_revision
  FOR EACH STATEMENT EXECUTE FUNCTION transaction_revision_immutable();
