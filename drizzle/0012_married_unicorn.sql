CREATE TABLE `llm_answers` (
	`thread_id` integer NOT NULL,
	`message_index` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `message_index`),
	FOREIGN KEY (`thread_id`) REFERENCES `llm_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
