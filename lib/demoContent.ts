/**
 * A single real, attributed sermon (transcript + generated output), used to
 * power the "View Demo" preview on the landing page without spending a real
 * request or rate limit slot. Used with permission: Jake works at this
 * church. See AGENTS.md's Public Demo section before changing this content
 * or adding more demo entries.
 *
 * DEMO_OUTPUT is not live model output. It started as a real
 * gemini-3.5-flash-lite response to the transcript below, then was hand
 * checked against the STRICT VERBATIM RULE and METADATA ANCHOR RULE in
 * lib/systemPrompt.ts (one dropped leading word and one clip's timestamp
 * were off by a few seconds; both corrected here) before being frozen as a
 * static asset. Treat edits to it with the same scrutiny: any change must
 * still be a word for word match against the source transcript.
 */

export const DEMO_ATTRIBUTION = {
  speaker: "Pastor Jay Stewart",
  church: "The Refuge Church",
  url: "https://therefuge.net",
} as const;

export const DEMO_LABEL =
  "1 Kings 17-22; 2 Chronicles 18-23 (Pastor Jay Stewart, The Refuge Church)";

export const DEMO_OUTPUT = `### Titles

Option 1: When Your Sources of Provision Suddenly Dry Up
Option 2: Why God Refuses to Fit Into Our Formulas
Option 3: What the Story of Elijah Teaches Us About Doubt

### Description

Sometimes the very things we rely on begin to fade, leaving us stranded in situations we never expected. We often view these dry seasons as setbacks, failing to realize that unexpected shifts are simply new assignments designed to position us for something greater.

The story of Elijah challenges how we view provision, faith, and obedience. When supernatural streams dry up and daily survival seems impossible, we are invited to trust a God whose ways defy human logic. Instead of relying on predictable formulas or holding back what we think we need, we are called to put our trust in the One who provides even when the math does not add up.

True faith requires us to stop hesitating between competing loyalties and surrender completely. We cannot compartmentalize our lives, keeping a safe distance while expecting God to bless the rest. When we allow His fire to consume our doubts, we discover a steadfast presence that carries us through every barren season.

### Chapters

00:00 Introduction
00:51 When Our Streams of Provision Dry Up
07:58 Finding Purpose in Unexpected Places
10:05 Learning the Principle of Giving First
15:13 Trusting God Through Impossible Grief
19:12 Confronting the Voices That Confuse Us
24:06 Why We Must Stop Hesitating
27:24 Needing the Fire of God in Our Culture

### Clips

Option 1
Timestamps: [00:04:05 - 00:05:27]
Duration: 82 seconds
Title: When the Brook Dries Up
Transcript: But after a while, the Brook dried up for there was no rainfall anywhere in the land. Let me ask you a question, has anybody ever experienced a season in your life when the Brook dried up? Does anybody know what I'm talking about? Like maybe you got laid off from your job and there was no real explanation for it and you didn't see it coming and you couldn't understand that stream of provision for you all of a sudden dried up. I've been journeying with someone who recently was just done wrong by corporate America and I'm sure there's some of you that can relate. Just treated unfairly, treated unjustly, didn't make sense, put in a position to have to resign. It was hurtful and painful and just wrong. Everything about it was wrong but now that person is beginning to see that it was the hand of God drying up that Brook because he was in a job that was slowly destroying his life.
Description: A reflection on unexpected job loss and how dry seasons often redirect our lives away from harmful environments.
Why it works: Highly relatable pain point that connects ancient biblical narratives to modern workplace struggles.

Option 2
Timestamps: [00:11:05 - 00:12:15]
Duration: 70 seconds
Title: When the Math Does Not Add Up
Transcript: But the Bible says that she did as Elijah said. She gave to the prophet first. Let me tell you, that's how tithing works. We give to God first. We don't wait until we've paid the bills and gone out to eat and bought the new purse, and then if we have some left over, we give that to God. That doesn't take any faith. But it takes faith on the front end when the math ain't mathin'. And you say, God, we're gonna honor you first. That's first fruits. We're gonna honor you first. And it doesn't work on paper that we're gonna have enough, but somehow, supernaturally, can I get a witness in the room that somehow, supernaturally, even though it doesn't work, even though the math ain't mathin', that when you honor God first, he always takes care of you.
Description: A practical perspective on financial trust and putting generosity before personal security.
Why it works: Uses engaging modern vernacular ("the math ain't mathin'") to address a common area of anxiety.

Option 3
Timestamps: [00:24:03 - 00:25:21]
Duration: 78 seconds
Title: Living in a Culture of Hesitation
Transcript: That word hobbling in the Hebrew is the word pasaq. And it means this, it means to hesitate. It means to make lame. In other words, we're living in a culture of people who are hesitating. Well, I wanna follow God, but I don't know. Is God the only way? We live in a culture that says there's many ways to God and we find people that are hesitating, we find people that are paralyzed and not moving at all. Elijah says, how long are you gonna do this? Where you're just hesitating, you're not making a choice. Some of you are just paralyzed, you're not even moving, you're not moving at all.
Description: An examination of spiritual hesitation and the modern tendency to avoid making definitive commitments to faith.
Why it works: Directly addresses the cultural skepticism and spiritual paralysis experienced by many today.
`;
