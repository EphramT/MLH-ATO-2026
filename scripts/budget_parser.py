import pandas as pd

# Example URL pointing to Raleigh's Open Data CSV export or API endpoint
# (Replace with the direct CSV export link from data.raleighnc.gov for the Adopted Expense Budget)
DATA_URL = "https://data.raleighnc.gov/datasets/raleigh::adopted-expense-budget.csv"

ADOPTED_EXPENSES_API = "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Adopted_Expense_Budget/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson"

def fetch_and_parse_budget(csv_path_or_url):
    df = pd.read_csv(csv_path_or_url)
    
    # Filter for the target fiscal year (e.g., FY2027)
    fy27_df = df[df['FiscalYear'] == 'FY2027'] # Adjust column name based on schema
    
    # Group expenses by department or program
    department_totals = fy27_df.groupby('Department')['AdoptedBudget'].sum().reset_index()
    
    # Calculate percentage of total budget
    total_budget = department_totals['AdoptedBudget'].sum()
    department_totals['Percentage'] = (department_totals['AdoptedBudget'] / total_budget) * 100
    
    return department_totals

# To run your tool:
# summary_df = fetch_and_parse_budget(DATA_URL)
# print(summary_df)