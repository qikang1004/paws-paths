---
name: Paws & Paths
colors:
  surface: '#fff8f5'
  surface-dim: '#e7d7ce'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1ea'
  surface-container: '#fbebe2'
  surface-container-high: '#f5e5dc'
  surface-container-highest: '#f0dfd7'
  on-surface: '#221a15'
  on-surface-variant: '#544339'
  inverse-surface: '#382f29'
  inverse-on-surface: '#feede5'
  outline: '#877367'
  outline-variant: '#dac2b4'
  surface-tint: '#944a07'
  primary: '#944a07'
  on-primary: '#ffffff'
  primary-container: '#ff9f5a'
  on-primary-container: '#733700'
  inverse-primary: '#ffb786'
  secondary: '#4a6549'
  on-secondary: '#ffffff'
  secondary-container: '#ccebc7'
  on-secondary-container: '#506b4f'
  tertiary: '#006973'
  on-tertiary: '#ffffff'
  tertiary-container: '#3ec7d8'
  on-tertiary-container: '#004f58'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc6'
  primary-fixed-dim: '#ffb786'
  on-primary-fixed: '#311300'
  on-primary-fixed-variant: '#723600'
  secondary-fixed: '#ccebc7'
  secondary-fixed-dim: '#b0cfad'
  on-secondary-fixed: '#07200b'
  on-secondary-fixed-variant: '#334d33'
  tertiary-fixed: '#93f1ff'
  tertiary-fixed-dim: '#54d8e9'
  on-tertiary-fixed: '#001f23'
  on-tertiary-fixed-variant: '#004f57'
  background: '#fff8f5'
  on-background: '#221a15'
  surface-variant: '#f0dfd7'
typography:
  headline-xl:
    fontFamily: Quicksand
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Quicksand
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Quicksand
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Quicksand
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-md:
    fontFamily: Quicksand
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Quicksand
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Quicksand
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  margin-mobile: 20px
  gutter-mobile: 12px
---

## Brand & Style

The design system is centered on a "Warm Organic" aesthetic, blending modern minimalism with soft, tactile elements to evoke feelings of companionship and joy. It targets pet owners seeking a safe, upbeat community. 

The style utilizes high-quality imagery of pets paired with generous whitespace and "squishy" interactive elements. This creates a friendly, approachable atmosphere that feels more like a digital park than a rigid social network. Key traits include:
- **Caring:** Soft edges and warm tones.
- **Joyful:** Vibrant accent colors and playful motion.
- **Trustworthy:** Clear, legible typography and consistent spacing.

## Colors

This design system uses a nature-inspired palette to maintain a "walk in the park" feel. 
- **Primary (Soft Orange):** Used for call-to-actions, brand accents, and active states to convey energy and enthusiasm.
- **Secondary (Sage Green):** Applied to nature-related tags, health indicators, and outdoor activity markers.
- **Background (Warm Cream):** A soft, non-white base that reduces eye strain and feels more inviting and premium.
- **Text (Chocolate Brown):** Provides high legibility while appearing softer and more organic than pure black.
- **Tertiary (Sunny Yellow):** Used sparingly for "delight" moments, such as badges or notifications.

## Typography

The typography system relies entirely on **Quicksand** for its distinctively rounded terminals, which mirror the "paw-friendly" shape language of the brand.

- **Headlines:** Set with tight letter-spacing and bold weights to create a "hug-like" visual density.
- **Body:** Uses medium weights for better legibility against the cream background.
- **Labels:** Used for pet categories or metadata; these should always be set with increased tracking to ensure clarity at small scales.
- **Mobile Adjustments:** Headlines above 24px should be used sparingly for hero sections only to maximize screen real estate.

## Layout & Spacing

This design system follows a **flexible 4-column grid** for mobile mini-programs. 
- **Margins:** 20px on the left and right edges to ensure content doesn't feel cramped.
- **Gaps:** 12px gutters between cards in a feed.
- **Vertical Rhythm:** Content blocks follow a 16px/24px/32px progression. Use 32px to separate distinct sections (e.g., "Trending Pets" vs "Near You") and 16px for internal card padding.
- **Safe Areas:** Adhere strictly to mobile notch and home indicator safe zones, ensuring bottom navigation bars are elevated.

## Elevation & Depth

To maintain a soft and friendly feel, this design system avoids harsh, high-contrast shadows.
- **Surface Layers:** Use subtle tonal shifts (e.g., a slightly lighter cream or white) to indicate hierarchy before resorting to shadows.
- **Ambient Shadows:** Shadows should be long, diffused, and tinted with the Chocolate Brown text color at very low opacity (5-8%). They should feel like they are floating on a soft surface.
- **Interactive States:** When a card or button is pressed, it should "sink" (reduce shadow and slightly scale down) to provide a tactile, squishy physical metaphor.

## Shapes

The shape language is the core of this design system's friendliness.
- **Elements:** All buttons, cards, and input fields use a minimum radius of 16px (`rounded-lg`).
- **Icons:** Use icons with rounded caps and corners. Avoid sharp angles or thin, spiky lines.
- **Avatars:** Pet profile pictures should be perfectly circular to stand out from the rectangular but rounded post cards.
- **Pills:** All tags and categories use a full "pill" shape (max roundedness).

## Components

### Buttons
- **Primary:** Soft Orange background with White or Chocolate Brown text. Large rounded corners (Pill).
- **Secondary:** Sage Green background with White text, used for "Follow" or "Join Group."
- **Ghost:** Chocolate Brown border (2px) with transparent center.

### Cards
- **Post Cards:** White background to pop against the Cream page. Soft, diffused shadow. Top corners of imagery should match the card's 16px radius.
- **Pet Profile Cards:** Features a prominent circular avatar overlapping a landscape-oriented header image.

### Inputs & Selection
- **Fields:** Cream-colored fill with a subtle 1px Brown border that thickens to 2px Orange on focus.
- **Checkboxes:** Styled as circular "bubbles" rather than squares.
- **Chips:** Small pill-shaped containers in Sage Green or Primary Orange with 12px Label typography.

### Playful Elements
- **Progress Bars:** Thick, rounded bars using the Primary Orange.
- **Empty States:** Custom illustrations featuring "paw" motifs or friendly pet characters in the brand's secondary colors.