import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/ui/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.primary }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.rounds'),
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'flag.fill', android: 'golf_course', web: 'golf_course' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabs.stats'),
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }} tintColor={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}
