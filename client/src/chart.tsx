import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const FinancialChart = ({ rawData }: { rawData: string }) => {
  const jsonMatch = rawData.match(/\[CHART_DATA:\s*([\s\S]*?)\]/);
  if (!jsonMatch) return null;

  const dataObj = JSON.parse(jsonMatch[1]);
  const chartData = Object.entries(dataObj).map(([name, value]) => ({ 
    name, 
    value: Number(value) 
  }));

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

  return (
    <div style={{ height: '200px', width: '100%', marginTop: '10px' }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={chartData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#1c1c1e', border: 'none', borderRadius: '8px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default FinancialChart; 