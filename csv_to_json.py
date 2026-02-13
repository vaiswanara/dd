import csv
import json
import os

# Configuration
INPUT_FILE = 'family_data.csv'
OUTPUT_FILE = 'family_data.json'

def convert_csv_to_json():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: '{INPUT_FILE}' not found in the current directory.")
        return

    data = []

    # Open the CSV file. 'utf-8-sig' handles BOM if present (common in Excel CSVs)
    with open(INPUT_FILE, mode='r', encoding='utf-8-sig') as csv_file:
        # DictReader automatically uses the first row as headers
        csv_reader = csv.DictReader(csv_file)
        
        for row in csv_reader:
            # Handle 'pids' specifically to convert "I1,I2" string into a list ["I1", "I2"]
            if 'pids' in row and row['pids']:
                # Split by comma, strip whitespace, and filter out empty strings
                row['pids'] = [pid.strip() for pid in row['pids'].split(',') if pid.strip()]
            else:
                row['pids'] = []
            
            data.append(row)

    # Write to JSON file
    with open(OUTPUT_FILE, mode='w', encoding='utf-8') as json_file:
        # indent=None reduces file size (minified), indent=2 makes it readable
        json.dump(data, json_file, indent=None, ensure_ascii=False)

    print(f"Success! Converted {len(data)} records to '{OUTPUT_FILE}'.")

if __name__ == "__main__":
    convert_csv_to_json()