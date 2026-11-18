-- Stored AI conversations were in the Anthropic SDK's message format, which the provider-neutral layer cannot read.
-- Ask threads and their structured answers go; set and library-plan threads keep their row (sets reference it) with no messages.
-- Sets, set items, picks, recaps, notes, library plans and items, and the spend ledger are untouched.
DELETE FROM `llm_answers` WHERE `thread_id` IN (SELECT `id` FROM `llm_threads` WHERE `feature` = 'ask');
--> statement-breakpoint
DELETE FROM `llm_threads` WHERE `feature` = 'ask';
--> statement-breakpoint
UPDATE `llm_threads` SET `messages` = '[]';
