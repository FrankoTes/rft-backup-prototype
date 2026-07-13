export function classifyError(error) {
  if (error?.name === 'TransportError') {
    const map = {
      server_unreachable: ['major', 'La destination SFTP est inaccessible.', 'Serveur arrêté, DNS invalide, port fermé ou pare-feu bloquant.'],
      timeout: ['major', 'Le délai SFTP est dépassé.', 'Serveur lent ou réseau instable.'],
      authentication_refused: ['major', "L'authentification SFTP est refusée.", 'Nom utilisateur ou mot de passe incorrect.'],
      permission_denied: ['major', "RFT Backup n'a pas les permissions nécessaires sur la destination.", 'Droits insuffisants sur le répertoire distant.'],
      remote_directory_unavailable: ['major', 'Le répertoire distant SFTP est inaccessible.', 'Chemin distant absent ou non accessible.'],
      transfer_interrupted: ['major', 'Le transfert SFTP a été interrompu.', 'Connexion coupée pendant le téléversement.'],
      insufficient_space: ['major', "L'espace distant est insuffisant.", 'Quota ou disque distant plein.'],
      validation_failed: ['critical', 'La validation du fichier distant a échoué.', 'Le fichier distant est absent ou sa taille diffère.'],
      invalid_configuration: ['minor', 'La configuration de destination est invalide.', 'Un paramètre SFTP obligatoire est absent ou incorrect.'],
    };
    const [severity, explanation, probableCause] = map[error.code] ?? ['major', 'Le transport de sauvegarde a échoué.', 'Incident de transfert non classé.'];
    return { severity, explanation, probableCause, suggestedSolution: 'Corrigez la configuration puis testez la connexion avant de relancer la sauvegarde.', technicalMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('auth') || lower.includes('permission')) return { severity: 'major', explanation: "RFT Backup n'a pas pu accéder à la destination SFTP.", probableCause: 'Identifiants incorrects ou droits insuffisants.', suggestedSolution: 'Vérifiez le nom utilisateur, le mot de passe ou la clé SSH, puis testez la connexion.', technicalMessage: message };
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('econn')) return { severity: 'major', explanation: 'La destination SFTP est momentanément inaccessible.', probableCause: 'Réseau indisponible, serveur arrêté ou pare-feu bloquant.', suggestedSolution: 'Vérifiez la connexion Internet et les paramètres du serveur SFTP.', technicalMessage: message };
  if (lower.includes('hash') || lower.includes('integrity')) return { severity: 'critical', explanation: "La vérification d'intégrité a échoué.", probableCause: 'Le fichier transféré ne correspond pas au fichier préparé.', suggestedSolution: 'Relancez la sauvegarde. Si le problème persiste, contactez le support.', technicalMessage: message };
  return { severity: 'minor', explanation: "La sauvegarde n'a pas pu se terminer.", probableCause: 'Un incident inattendu est survenu.', suggestedSolution: 'Réessayez. Les détails techniques sont conservés pour le support.', technicalMessage: message };
}
