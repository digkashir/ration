// Настройки подключения к Google. Эти значения не секретные:
// они защищены ограничением на адрес https://digkashir.github.io
export const CONFIG = {
  version: '0.1.0',
  clientId: '299241992215-8a6dmdsn20etn08hpqo8bjfo2d62scrt.apps.googleusercontent.com',
  apiKey: 'AIzaSyCjoOADmqNWKAXbLDDTJsC4nGxOC-f4A00',
  appId: '299241992215', // номер проекта Google Cloud (нужен окну выбора файла)
  scope: 'https://www.googleapis.com/auth/drive.file',
  folderName: 'Планировщик еды',
  fileName: 'ration-db.json',
  syncDebounceMs: 2500,
  syncIntervalMs: 60000,
};

// Группы тэгов (раздел 3.2.1 project state). Новые группы пользователь создавать не может.
export const TAG_GROUPS = [
  { id: 'meal', name: 'Время приёма', locked: true },
  { id: 'ingredients', name: 'Группы ингредиентов' },
  { id: 'nutrition', name: 'Питательная ценность' },
  { id: 'type', name: 'Тип блюда' },
];

export const COLLECTIONS = ['ingredients', 'tags', 'recipes', 'persons', 'plan'];
