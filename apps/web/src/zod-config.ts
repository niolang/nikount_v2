import { config } from 'zod';

// La CSP interdit `eval` : Zod ne doit même pas tenter de compiler ses validateurs avec
// `new Function` (la tentative bloquée déclencherait une violation de CSP à chaque chargement).
config({ jitless: true });
