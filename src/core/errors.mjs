export function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('auth') || lower.includes('permission')) return { severity: 'major', explanation: "RFT Backup n'a pas pu accéder à la destination SFTP.", probableCause: 'Identifiants incorrects ou droits insuffisants.', suggestedSolution: 'Vérifiez le nom utilisateur, le mot de passe ou la clé SSH, puis testez la connexion.', technicalMessage: message };
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('econn')) return { severity: 'major', explanation: 'La destination SFTP est momentanément inaccessible.', probableCause: 'Réseau indisponible, serveur arrêté ou pare-feu bloquant.', suggestedSolution: 'Vérifiez la connexion Internet et les paramètres du serveur SFTP.', technicalMessage: message };
  if (lower.includes('hash') || lower.includes('integrity')) return { severity: 'critical', explanation: "La vérification d'intégrité a échoué.", probableCause: 'Le fichier transféré ne correspond pas au fichier préparé.', suggestedSolution: 'Relancez la sauvegarde. Si le problème persiste, contactez le support.', technicalMessage: message };
  return { severity: 'minor', explanation: "La sauvegarde n'a pas pu se terminer.", probableCause: 'Un incident inattendu est survenu.', suggestedSolution: 'Réessayez. Les détails techniques sont conservés pour le support.', technicalMessage: message };
}
