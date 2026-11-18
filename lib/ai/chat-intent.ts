/**
 * What the user is asking the chat to do.
 *
 * These predicates decide which tool is forced on the first step. They live
 * outside the route so the rules can be tested directly: a false positive here
 * does not produce a slightly worse answer, it replaces the user's work.
 */

/** True when the user asked for a quiz. */
export function askedForQuiz(text: string): boolean {
  return /\bquiz\b/i.test(text) || /\btest me\b/i.test(text);
}

/**
 * True when the user asked to change one slide.
 *
 * Forcing `slidesEdit` keeps a small request small: the model must rewrite the
 * named slide rather than regenerate the deck around it.
 */
export function askedToEditSlide(text: string): boolean {
  return (
    /\bslide\s+\d+\b/i.test(text) &&
    /\b(?:edit|change|update|rewrite|shorten|revise|tweak|fix|make|turn|replace|reword|improve)\b/i.test(
      text
    )
  );
}

/**
 * True when the user asked for a new deck.
 *
 * The model is forced to `slidesCreate` on the first step. Without that, a long
 * prompt can make it answer with a slide outline in chat instead of creating
 * the deck the studio can open and export.
 *
 * A request to change an existing slide is not a request for a new deck. The
 * first version of this test matched "make slide 2 shorter" and forced a full
 * regeneration, which silently replaced the user's deck.
 */
export function askedForSlides(text: string): boolean {
  if (askedToEditSlide(text)) {
    return false;
  }

  return /\b(?:create|make|build|generate|design|prepare|draft|turn|need)\b[\s\S]{0,100}\b(?:slides?|deck|presentation|powerpoint|pptx|pitch)\b/i.test(
    text
  );
}
