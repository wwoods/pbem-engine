// With tree-shaking, neither @types/gsap nor @types/greensock work.  So, just
// use this dummy type file, I suppose.
// TODO: fix for actual typescript.   Perhaps import @types/greensock as
// needed.
declare module 'gsap/TweenMax';
