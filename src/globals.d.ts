// Ambient declarations so TypeScript understands CSS imports used by the
// Expo template (global stylesheet + CSS modules).
declare module '*.css';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
