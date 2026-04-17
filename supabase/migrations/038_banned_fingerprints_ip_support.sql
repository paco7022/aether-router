ALTER TABLE banned_fingerprints ADD COLUMN ip_address text;
ALTER TABLE banned_fingerprints ALTER COLUMN fingerprint DROP NOT NULL;
ALTER TABLE banned_fingerprints ADD CONSTRAINT banned_fingerprints_has_key CHECK (fingerprint IS NOT NULL OR ip_address IS NOT NULL);
CREATE UNIQUE INDEX banned_fingerprints_ip_address_key ON banned_fingerprints (ip_address) WHERE ip_address IS NOT NULL;
