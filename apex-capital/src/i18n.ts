import { settings, useSettings, type Lang } from './game/settings.ts';

// Interface language. Market data, instrument names and admin-written chat
// stay as-is; every piece of app chrome goes through t().

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' },
  { id: 'id', label: 'Bahasa Indonesia' },
];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.trade': 'Trade', 'nav.chat': 'Chat', 'nav.wealth': 'Wealth', 'nav.settings': 'Settings',
  'sub.quotes': 'Quotes', 'sub.chart': 'Chart', 'sub.trade': 'Trade', 'sub.history': 'History',
  'cls.fx': 'Forex', 'cls.futures': 'Futures', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'New order', 'q.chart': 'Open chart', 'q.delete': 'Delete', 'q.add': 'Add symbol', 'q.search': 'Search symbols', 'q.swipe': 'Swipe a symbol left for actions', 'q.open': 'Open', 'q.closed': 'Closed',
  't.balance': 'Balance', 't.equity': 'Equity', 't.margin': 'Margin', 't.free': 'Free margin', 't.level': 'Margin level', 't.positions': 'Positions', 't.orders': 'Orders', 't.new': 'New order', 't.noPos': 'No open positions', 't.noPosSub': 'Open a trade from Quotes, the Chart or New order.', 't.close': 'Close', 't.modify': 'Modify', 't.cancel': 'Cancel order', 't.closeAll': 'Close all', 't.closeWin': 'Close profitable', 't.closeLoss': 'Close losing', 't.profit': 'Profit',
  'o.type': 'Order type', 'o.market': 'Market Execution', 'o.volume': 'Volume', 'o.price': 'Price', 'o.stopLimit': 'Stop Limit price', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Deviation (points)', 'o.expiration': 'Expiration', 'o.gtc': 'GTC', 'o.today': 'Today', 'o.specified': 'Specified', 'o.sell': 'Sell by Market', 'o.buy': 'Buy by Market', 'o.place': 'Place', 'o.fill': 'Fill policy',
  'h.positions': 'Positions', 'h.orders': 'Orders', 'h.deals': 'Deals', 'h.show': 'Show on chart', 'h.empty': 'No history for this period', 'h.today': 'Today', 'h.week': 'Last week', 'h.month': 'Last month', 'h.all': 'All', 'h.share': 'Share',
  'w.rank': 'Rank', 'w.board': 'Leaderboard', 'w.balance': 'Your balance', 'w.world': 'Worldwide', 'w.group': 'Your group', 'w.friends': 'Friends',
  's.newAccount': 'New account', 's.mailbox': 'Mailbox', 's.news': 'News', 's.interface': 'Interface', 's.charts': 'Charts', 's.language': 'Language', 's.appearance': 'Appearance', 's.notifications': 'Notifications', 's.about': 'About',
  'c.communities': 'Communities', 'c.direct': 'Direct', 'c.friends': 'Friends', 'c.search': 'Search username', 'c.add': 'Add friend', 'c.message': 'Message', 'c.requests': 'Friend requests',
  'x.back': 'Back', 'x.cancel': 'Cancel', 'x.save': 'Save', 'x.done': 'Done', 'x.delete': 'Delete', 'x.close': 'Close',
};

const es: Dict = {
  'nav.trade': 'Operar', 'nav.chat': 'Chat', 'nav.wealth': 'Riqueza', 'nav.settings': 'Ajustes',
  'sub.quotes': 'Cotizaciones', 'sub.chart': 'Gráfico', 'sub.trade': 'Operaciones', 'sub.history': 'Historial',
  'cls.fx': 'Forex', 'cls.futures': 'Futuros', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'Nueva orden', 'q.chart': 'Abrir gráfico', 'q.delete': 'Eliminar', 'q.add': 'Añadir símbolo', 'q.search': 'Buscar símbolos', 'q.swipe': 'Desliza un símbolo a la izquierda', 'q.open': 'Abierto', 'q.closed': 'Cerrado',
  't.balance': 'Balance', 't.equity': 'Capital', 't.margin': 'Margen', 't.free': 'Margen libre', 't.level': 'Nivel de margen', 't.positions': 'Posiciones', 't.orders': 'Órdenes', 't.new': 'Nueva orden', 't.noPos': 'Sin posiciones abiertas', 't.noPosSub': 'Abre una operación desde Cotizaciones, el Gráfico o Nueva orden.', 't.close': 'Cerrar', 't.modify': 'Modificar', 't.cancel': 'Cancelar orden', 't.closeAll': 'Cerrar todo', 't.closeWin': 'Cerrar ganadoras', 't.closeLoss': 'Cerrar perdedoras', 't.profit': 'Beneficio',
  'o.type': 'Tipo de orden', 'o.market': 'Ejecución de mercado', 'o.volume': 'Volumen', 'o.price': 'Precio', 'o.stopLimit': 'Precio Stop Limit', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Desviación (puntos)', 'o.expiration': 'Vencimiento', 'o.gtc': 'GTC', 'o.today': 'Hoy', 'o.specified': 'Especificado', 'o.sell': 'Vender a mercado', 'o.buy': 'Comprar a mercado', 'o.place': 'Colocar', 'o.fill': 'Política de llenado',
  'h.positions': 'Posiciones', 'h.orders': 'Órdenes', 'h.deals': 'Transacciones', 'h.show': 'Ver en el gráfico', 'h.empty': 'Sin historial en este periodo', 'h.today': 'Hoy', 'h.week': 'Última semana', 'h.month': 'Último mes', 'h.all': 'Todo', 'h.share': 'Compartir',
  'w.rank': 'Rango', 'w.board': 'Clasificación', 'w.balance': 'Tu balance', 'w.world': 'Mundial', 'w.group': 'Tu grupo', 'w.friends': 'Amigos',
  's.newAccount': 'Nueva cuenta', 's.mailbox': 'Buzón', 's.news': 'Noticias', 's.interface': 'Interfaz', 's.charts': 'Gráficos', 's.language': 'Idioma', 's.appearance': 'Apariencia', 's.notifications': 'Notificaciones', 's.about': 'Acerca de',
  'c.communities': 'Comunidades', 'c.direct': 'Directo', 'c.friends': 'Amigos', 'c.search': 'Buscar usuario', 'c.add': 'Añadir amigo', 'c.message': 'Mensaje', 'c.requests': 'Solicitudes',
  'x.back': 'Atrás', 'x.cancel': 'Cancelar', 'x.save': 'Guardar', 'x.done': 'Listo', 'x.delete': 'Eliminar', 'x.close': 'Cerrar',
};

const fr: Dict = {
  'nav.trade': 'Trading', 'nav.chat': 'Chat', 'nav.wealth': 'Patrimoine', 'nav.settings': 'Réglages',
  'sub.quotes': 'Cotations', 'sub.chart': 'Graphique', 'sub.trade': 'Trading', 'sub.history': 'Historique',
  'cls.fx': 'Forex', 'cls.futures': 'Futures', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'Nouvel ordre', 'q.chart': 'Ouvrir le graphique', 'q.delete': 'Supprimer', 'q.add': 'Ajouter un symbole', 'q.search': 'Rechercher', 'q.swipe': 'Glissez un symbole vers la gauche', 'q.open': 'Ouvert', 'q.closed': 'Fermé',
  't.balance': 'Solde', 't.equity': 'Fonds propres', 't.margin': 'Marge', 't.free': 'Marge libre', 't.level': 'Niveau de marge', 't.positions': 'Positions', 't.orders': 'Ordres', 't.new': 'Nouvel ordre', 't.noPos': 'Aucune position ouverte', 't.noPosSub': 'Ouvrez un trade depuis Cotations, le Graphique ou Nouvel ordre.', 't.close': 'Clôturer', 't.modify': 'Modifier', 't.cancel': 'Annuler l’ordre', 't.closeAll': 'Tout clôturer', 't.closeWin': 'Clôturer gagnantes', 't.closeLoss': 'Clôturer perdantes', 't.profit': 'Profit',
  'o.type': 'Type d’ordre', 'o.market': 'Exécution au marché', 'o.volume': 'Volume', 'o.price': 'Prix', 'o.stopLimit': 'Prix Stop Limit', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Déviation (points)', 'o.expiration': 'Expiration', 'o.gtc': 'GTC', 'o.today': 'Aujourd’hui', 'o.specified': 'Spécifiée', 'o.sell': 'Vendre au marché', 'o.buy': 'Acheter au marché', 'o.place': 'Placer', 'o.fill': 'Politique de remplissage',
  'h.positions': 'Positions', 'h.orders': 'Ordres', 'h.deals': 'Transactions', 'h.show': 'Voir sur le graphique', 'h.empty': 'Aucun historique', 'h.today': 'Aujourd’hui', 'h.week': 'Semaine', 'h.month': 'Mois', 'h.all': 'Tout', 'h.share': 'Partager',
  'w.rank': 'Rang', 'w.board': 'Classement', 'w.balance': 'Votre solde', 'w.world': 'Mondial', 'w.group': 'Votre groupe', 'w.friends': 'Amis',
  's.newAccount': 'Nouveau compte', 's.mailbox': 'Messagerie', 's.news': 'Actualités', 's.interface': 'Interface', 's.charts': 'Graphiques', 's.language': 'Langue', 's.appearance': 'Apparence', 's.notifications': 'Notifications', 's.about': 'À propos',
  'c.communities': 'Communautés', 'c.direct': 'Direct', 'c.friends': 'Amis', 'c.search': 'Rechercher un pseudo', 'c.add': 'Ajouter', 'c.message': 'Message', 'c.requests': 'Demandes d’amis',
  'x.back': 'Retour', 'x.cancel': 'Annuler', 'x.save': 'Enregistrer', 'x.done': 'OK', 'x.delete': 'Supprimer', 'x.close': 'Fermer',
};

const de: Dict = {
  'nav.trade': 'Handel', 'nav.chat': 'Chat', 'nav.wealth': 'Vermögen', 'nav.settings': 'Einstellungen',
  'sub.quotes': 'Kurse', 'sub.chart': 'Chart', 'sub.trade': 'Handel', 'sub.history': 'Verlauf',
  'cls.fx': 'Forex', 'cls.futures': 'Futures', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'Neue Order', 'q.chart': 'Chart öffnen', 'q.delete': 'Löschen', 'q.add': 'Symbol hinzufügen', 'q.search': 'Symbole suchen', 'q.swipe': 'Symbol nach links wischen', 'q.open': 'Offen', 'q.closed': 'Geschlossen',
  't.balance': 'Kontostand', 't.equity': 'Equity', 't.margin': 'Margin', 't.free': 'Freie Margin', 't.level': 'Margin-Level', 't.positions': 'Positionen', 't.orders': 'Orders', 't.new': 'Neue Order', 't.noPos': 'Keine offenen Positionen', 't.noPosSub': 'Eröffne einen Trade über Kurse, Chart oder Neue Order.', 't.close': 'Schließen', 't.modify': 'Ändern', 't.cancel': 'Order löschen', 't.closeAll': 'Alle schließen', 't.closeWin': 'Gewinner schließen', 't.closeLoss': 'Verlierer schließen', 't.profit': 'Gewinn',
  'o.type': 'Ordertyp', 'o.market': 'Market Execution', 'o.volume': 'Volumen', 'o.price': 'Preis', 'o.stopLimit': 'Stop-Limit-Preis', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Abweichung (Punkte)', 'o.expiration': 'Ablauf', 'o.gtc': 'GTC', 'o.today': 'Heute', 'o.specified': 'Festgelegt', 'o.sell': 'Verkaufen (Markt)', 'o.buy': 'Kaufen (Markt)', 'o.place': 'Platzieren', 'o.fill': 'Füllrichtlinie',
  'h.positions': 'Positionen', 'h.orders': 'Orders', 'h.deals': 'Deals', 'h.show': 'Im Chart zeigen', 'h.empty': 'Kein Verlauf', 'h.today': 'Heute', 'h.week': 'Letzte Woche', 'h.month': 'Letzter Monat', 'h.all': 'Alle', 'h.share': 'Teilen',
  'w.rank': 'Rang', 'w.board': 'Rangliste', 'w.balance': 'Dein Konto', 'w.world': 'Weltweit', 'w.group': 'Deine Gruppe', 'w.friends': 'Freunde',
  's.newAccount': 'Neues Konto', 's.mailbox': 'Postfach', 's.news': 'Nachrichten', 's.interface': 'Oberfläche', 's.charts': 'Charts', 's.language': 'Sprache', 's.appearance': 'Darstellung', 's.notifications': 'Benachrichtigungen', 's.about': 'Info',
  'c.communities': 'Communitys', 'c.direct': 'Direkt', 'c.friends': 'Freunde', 'c.search': 'Benutzername suchen', 'c.add': 'Freund hinzufügen', 'c.message': 'Nachricht', 'c.requests': 'Anfragen',
  'x.back': 'Zurück', 'x.cancel': 'Abbrechen', 'x.save': 'Speichern', 'x.done': 'Fertig', 'x.delete': 'Löschen', 'x.close': 'Schließen',
};

const pt: Dict = {
  'nav.trade': 'Negociar', 'nav.chat': 'Chat', 'nav.wealth': 'Patrimônio', 'nav.settings': 'Ajustes',
  'sub.quotes': 'Cotações', 'sub.chart': 'Gráfico', 'sub.trade': 'Negociação', 'sub.history': 'Histórico',
  'cls.fx': 'Forex', 'cls.futures': 'Futuros', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'Nova ordem', 'q.chart': 'Abrir gráfico', 'q.delete': 'Excluir', 'q.add': 'Adicionar símbolo', 'q.search': 'Buscar símbolos', 'q.swipe': 'Deslize um símbolo para a esquerda', 'q.open': 'Aberto', 'q.closed': 'Fechado',
  't.balance': 'Saldo', 't.equity': 'Capital', 't.margin': 'Margem', 't.free': 'Margem livre', 't.level': 'Nível de margem', 't.positions': 'Posições', 't.orders': 'Ordens', 't.new': 'Nova ordem', 't.noPos': 'Sem posições abertas', 't.noPosSub': 'Abra uma operação em Cotações, no Gráfico ou em Nova ordem.', 't.close': 'Fechar', 't.modify': 'Modificar', 't.cancel': 'Cancelar ordem', 't.closeAll': 'Fechar tudo', 't.closeWin': 'Fechar lucrativas', 't.closeLoss': 'Fechar perdedoras', 't.profit': 'Lucro',
  'o.type': 'Tipo de ordem', 'o.market': 'Execução a mercado', 'o.volume': 'Volume', 'o.price': 'Preço', 'o.stopLimit': 'Preço Stop Limit', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Desvio (pontos)', 'o.expiration': 'Expiração', 'o.gtc': 'GTC', 'o.today': 'Hoje', 'o.specified': 'Especificada', 'o.sell': 'Vender a mercado', 'o.buy': 'Comprar a mercado', 'o.place': 'Enviar', 'o.fill': 'Política de preenchimento',
  'h.positions': 'Posições', 'h.orders': 'Ordens', 'h.deals': 'Negócios', 'h.show': 'Ver no gráfico', 'h.empty': 'Sem histórico no período', 'h.today': 'Hoje', 'h.week': 'Última semana', 'h.month': 'Último mês', 'h.all': 'Tudo', 'h.share': 'Compartilhar',
  'w.rank': 'Ranking', 'w.board': 'Classificação', 'w.balance': 'Seu saldo', 'w.world': 'Mundial', 'w.group': 'Seu grupo', 'w.friends': 'Amigos',
  's.newAccount': 'Nova conta', 's.mailbox': 'Caixa de correio', 's.news': 'Notícias', 's.interface': 'Interface', 's.charts': 'Gráficos', 's.language': 'Idioma', 's.appearance': 'Aparência', 's.notifications': 'Notificações', 's.about': 'Sobre',
  'c.communities': 'Comunidades', 'c.direct': 'Direto', 'c.friends': 'Amigos', 'c.search': 'Buscar usuário', 'c.add': 'Adicionar amigo', 'c.message': 'Mensagem', 'c.requests': 'Pedidos de amizade',
  'x.back': 'Voltar', 'x.cancel': 'Cancelar', 'x.save': 'Salvar', 'x.done': 'OK', 'x.delete': 'Excluir', 'x.close': 'Fechar',
};

const id: Dict = {
  'nav.trade': 'Trading', 'nav.chat': 'Obrolan', 'nav.wealth': 'Kekayaan', 'nav.settings': 'Pengaturan',
  'sub.quotes': 'Kuotasi', 'sub.chart': 'Grafik', 'sub.trade': 'Trading', 'sub.history': 'Riwayat',
  'cls.fx': 'Forex', 'cls.futures': 'Futures', 'cls.nasdaq': 'Nasdaq',
  'q.order': 'Order baru', 'q.chart': 'Buka grafik', 'q.delete': 'Hapus', 'q.add': 'Tambah simbol', 'q.search': 'Cari simbol', 'q.swipe': 'Geser simbol ke kiri untuk aksi', 'q.open': 'Buka', 'q.closed': 'Tutup',
  't.balance': 'Saldo', 't.equity': 'Ekuitas', 't.margin': 'Margin', 't.free': 'Margin bebas', 't.level': 'Level margin', 't.positions': 'Posisi', 't.orders': 'Order', 't.new': 'Order baru', 't.noPos': 'Tidak ada posisi terbuka', 't.noPosSub': 'Buka trade dari Kuotasi, Grafik, atau Order baru.', 't.close': 'Tutup', 't.modify': 'Ubah', 't.cancel': 'Batalkan order', 't.closeAll': 'Tutup semua', 't.closeWin': 'Tutup yang profit', 't.closeLoss': 'Tutup yang rugi', 't.profit': 'Profit',
  'o.type': 'Jenis order', 'o.market': 'Eksekusi pasar', 'o.volume': 'Volume', 'o.price': 'Harga', 'o.stopLimit': 'Harga Stop Limit', 'o.sl': 'Stop Loss', 'o.tp': 'Take Profit', 'o.deviation': 'Deviasi (poin)', 'o.expiration': 'Kedaluwarsa', 'o.gtc': 'GTC', 'o.today': 'Hari ini', 'o.specified': 'Ditentukan', 'o.sell': 'Jual di pasar', 'o.buy': 'Beli di pasar', 'o.place': 'Pasang', 'o.fill': 'Kebijakan pengisian',
  'h.positions': 'Posisi', 'h.orders': 'Order', 'h.deals': 'Transaksi', 'h.show': 'Lihat di grafik', 'h.empty': 'Belum ada riwayat', 'h.today': 'Hari ini', 'h.week': 'Minggu lalu', 'h.month': 'Bulan lalu', 'h.all': 'Semua', 'h.share': 'Bagikan',
  'w.rank': 'Peringkat', 'w.board': 'Papan peringkat', 'w.balance': 'Saldo kamu', 'w.world': 'Seluruh dunia', 'w.group': 'Grup kamu', 'w.friends': 'Teman',
  's.newAccount': 'Akun baru', 's.mailbox': 'Kotak surat', 's.news': 'Berita', 's.interface': 'Antarmuka', 's.charts': 'Grafik', 's.language': 'Bahasa', 's.appearance': 'Tampilan', 's.notifications': 'Notifikasi', 's.about': 'Tentang',
  'c.communities': 'Komunitas', 'c.direct': 'Pesan langsung', 'c.friends': 'Teman', 'c.search': 'Cari username', 'c.add': 'Tambah teman', 'c.message': 'Pesan', 'c.requests': 'Permintaan teman',
  'x.back': 'Kembali', 'x.cancel': 'Batal', 'x.save': 'Simpan', 'x.done': 'Selesai', 'x.delete': 'Hapus', 'x.close': 'Tutup',
};

const DICTS: Record<Lang, Dict> = { en, es, fr, de, pt, id };

export function t(key: string): string {
  return DICTS[settings.s.lang]?.[key] ?? en[key] ?? key;
}

/** Re-render on language change. */
export function useT() {
  useSettings();
  return t;
}
